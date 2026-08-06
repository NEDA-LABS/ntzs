import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { nedaAccountLookup } from '@/lib/psp/selcom'
import { decodeMerchantQr, qrNameAgrees, TZS_CURRENCY_NUMERIC } from '@/lib/psp/qr'
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit'
import { isTestMode } from '@/lib/testmode'
import { authenticatePartner } from '@/lib/waas/auth'

// A merchant lookup goes upstream and can be slow; we may make a few in
// parallel. Same allowance as /lookup/merchant-name.
export const maxDuration = 60

const SCANS_PER_MINUTE = 120

/**
 * POST /api/v1/lookup/qr — turn a scanned merchant QR into something payable.
 *
 * A camera gives you a string, not a till number. TANQR codes are EMVCo
 * merchant-presented QR, and the merchant identifier lives in a scheme-defined
 * region of the payload — so "which number do I pay?" is a real question with
 * a non-obvious answer, and every partner would otherwise have to write a TLV
 * parser and guess at it. This endpoint answers it once, centrally.
 *
 * It returns the **Lipa Namba**, which is the same destination
 * `/v1/spend/quote` and `/v1/spend` already take. There is no separate QR rail
 * and nothing to enable: a scan is a shortcut to a till number you could have
 * typed.
 *
 * ── How the till number is established, and why not by guessing ────────────
 * The EMVCo envelope is standard and is decoded strictly (checksum verified,
 * no partial parses). Where the identifier sits inside the scheme's own
 * template is not standard, so instead of hardcoding a tag we take every
 * plausible identifier out of the code and ask the acquirer which one is a
 * registered merchant. Exactly one match resolves; several matches is reported
 * as ambiguous rather than resolved, because picking one would be picking who
 * gets paid.
 *
 * ── The sticker-swap check ────────────────────────────────────────────────
 * The common attack on printed QR is physical: a criminal pastes their own
 * code over the merchant's, so the customer sees the right shop and pays the
 * wrong account. The name printed inside the QR is attacker-controlled; the
 * name the acquirer holds is not. We compare them and return `nameMatch`.
 * False means show a warning and make the customer look twice.
 *
 * Moves no money, opens no rail, and is deliberately not behind the spend
 * flags — a partner should be able to finish and test their scan-to-pay screen
 * before the payment rail is switched on, not after.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult

  let body: { payload?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const payload = typeof body.payload === 'string' ? body.payload : ''
  if (!payload) {
    return NextResponse.json(
      { error: 'payload is required: the raw string your scanner read from the QR code.', code: 'payload_required' },
      { status: 400 }
    )
  }

  const decoded = decodeMerchantQr(payload)
  if (!decoded.ok) {
    return NextResponse.json({ error: decoded.error, code: decoded.code }, { status: 400 })
  }
  const qr = decoded.value

  const base = {
    qrMerchantName: qr.merchantName,
    merchantCity: qr.merchantCity,
    countryCode: qr.countryCode,
    currency: qr.currencyNumeric === TZS_CURRENCY_NUMERIC ? 'TZS' : qr.currencyNumeric,
    amountTzs: qr.amountTzs,
    dynamic: qr.dynamic,
    reference: qr.reference,
  }

  const warnings: string[] = []
  if (qr.currencyNumeric && qr.currencyNumeric !== TZS_CURRENCY_NUMERIC) {
    warnings.push('This code is priced in a currency other than TZS. Any amount it carries has been ignored — collect the amount from your user.')
  }
  if (qr.countryCode && qr.countryCode.toUpperCase() !== 'TZ') {
    warnings.push(`This code declares country ${qr.countryCode}, not TZ. It may not be payable on Tanzanian rails.`)
  }

  // TEST MODE: decode for real (it is pure), but never call the acquirer.
  // The first candidate resolves to the name printed in the code, so the whole
  // scan → confirm → quote → pay screen is buildable on a test key.
  if (isTestMode(partner)) {
    const payNumber = qr.candidateTillNumbers[0] ?? null
    return NextResponse.json({
      kind: 'lipa',
      ...base,
      payNumber,
      merchantName: qr.merchantName,
      nameMatch: payNumber ? true : null,
      resolution: payNumber ? 'resolved' : 'unresolved',
      ...(payNumber ? {} : { candidates: qr.candidateTillNumbers }),
      warnings,
    })
  }

  try {
    await enforceRateLimit(`qrscan:${partner.id}`, SCANS_PER_MINUTE, 60)
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Too many scans — slow down and retry shortly.' },
        { status: 429, headers: { 'Retry-After': String(err.retryAfterSec) } }
      )
    }
    throw err
  }

  if (qr.candidateTillNumbers.length === 0) {
    return NextResponse.json({
      kind: 'lipa',
      ...base,
      payNumber: null,
      merchantName: null,
      nameMatch: null,
      resolution: 'unresolved',
      candidates: [],
      warnings: [
        ...warnings,
        'The code is valid but carries no value shaped like a Lipa Namba. Ask the user to enter the till number printed beside the QR.',
      ],
    })
  }

  // Try in parallel: sequential upstream lookups would blow the request
  // budget, and we need every answer anyway to detect ambiguity.
  const tried = qr.candidateTillNumbers.slice(0, 3)
  const resolved = await Promise.all(
    tried.map(async (payNumber) => {
      try {
        const info = await nedaAccountLookup('SB2LIPA', payNumber)
        return info.name ? { payNumber, name: info.name } : null
      } catch {
        return null
      }
    })
  )
  const hits = resolved.filter((r): r is { payNumber: string; name: string } => r !== null)

  const audit = async (resolution: string, payNumber: string | null) => {
    try {
      const { sql } = getDb()
      await sql`
        insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
        values ('partner.qr_scan', 'partner', ${partner.id}, ${JSON.stringify({
          resolution,
          payNumber,
          candidates: tried.length,
        })}::jsonb, now())
      `
    } catch (err) {
      console.warn('[v1/lookup/qr] audit insert failed:', err instanceof Error ? err.message : err)
    }
  }

  if (hits.length === 0) {
    await audit('unresolved', null)
    return NextResponse.json({
      kind: 'lipa',
      ...base,
      payNumber: null,
      merchantName: null,
      nameMatch: null,
      resolution: 'unresolved',
      candidates: tried,
      warnings: [
        ...warnings,
        'No value in this code resolves to a registered merchant. Do not pay it — ask the user to confirm the till number printed beside the QR.',
      ],
    })
  }

  if (hits.length > 1) {
    // Two registered merchants in one code. Choosing between them would be
    // choosing who receives the money, which is not ours to decide silently.
    await audit('ambiguous', null)
    return NextResponse.json({
      kind: 'lipa',
      ...base,
      payNumber: null,
      merchantName: null,
      nameMatch: null,
      resolution: 'ambiguous',
      candidates: hits.map((h) => ({ payNumber: h.payNumber, name: h.name })),
      warnings: [
        ...warnings,
        'This code contains more than one registered merchant account. Ask the user to choose before paying.',
      ],
    })
  }

  const hit = hits[0]
  const nameMatch = qrNameAgrees(qr.merchantName, hit.name)
  if (nameMatch === false) {
    warnings.push(
      `The name printed in this code ("${qr.merchantName}") does not match the registered account holder ("${hit.name}"). A QR sticker pasted over another merchant's looks exactly like this. Show both names and make the user confirm before paying.`
    )
  }

  await audit('resolved', hit.payNumber)

  return NextResponse.json({
    kind: 'lipa',
    ...base,
    payNumber: hit.payNumber,
    merchantName: hit.name,
    nameMatch,
    resolution: 'resolved',
    warnings,
  })
}
