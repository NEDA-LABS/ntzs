import { NextRequest, NextResponse } from 'next/server'

import { requireAnyRole } from '@/lib/auth/rbac'
import { nedaAccountLookup } from '@/lib/psp/selcom'
import { decodeMerchantQr, qrNameAgrees } from '@/lib/psp/qr'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/qr-decode — super-admin probe for a scanned merchant QR.
 *
 * Same decoder as the partner endpoint (`/api/v1/lookup/qr`), but it returns
 * the FULL structure rather than the payable summary: every merchant-account
 * template, its scheme GUID, and each candidate till with the acquirer's
 * verdict on it.
 *
 * That detail is the point. `lib/psp/qr.ts` deliberately does not hardcode
 * which template tag carries the Lipa Namba, because that is scheme-defined
 * and we had no real code to read it from. Scanning one real merchant sticker
 * here answers it from evidence — exactly how the Selcom lookup vocabulary was
 * settled — and the raw payload is echoed back so it can be pinned as a test
 * fixture.
 *
 * Read-only. Decodes and resolves names; moves no money.
 */
export async function POST(request: NextRequest) {
  await requireAnyRole(['super_admin'])

  let body: { payload?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const payload = typeof body.payload === 'string' ? body.payload.trim() : ''
  if (!payload) {
    return NextResponse.json({ error: 'payload is required' }, { status: 400 })
  }

  const decoded = decodeMerchantQr(payload)
  if (!decoded.ok) {
    return NextResponse.json({ payload, ok: false, code: decoded.code, error: decoded.error })
  }
  const qr = decoded.value

  // Resolve every candidate, in parallel, and report each verdict — including
  // the misses. Which candidates FAIL is as informative as which one passes
  // when working out where the till really lives.
  const attempts = await Promise.all(
    qr.candidateTillNumbers.slice(0, 5).map(async (payNumber) => {
      try {
        const info = await nedaAccountLookup('SB2LIPA', payNumber)
        return { payNumber, name: info.name, reason: info.name ? undefined : info.reason }
      } catch (err) {
        return { payNumber, name: null, reason: err instanceof Error ? err.message : 'lookup threw' }
      }
    })
  )

  const hits = attempts.filter((a) => a.name)
  const resolved = hits.length === 1 ? hits[0] : null

  return NextResponse.json({
    payload,
    ok: true,
    decoded: {
      dynamic: qr.dynamic,
      merchantName: qr.merchantName,
      merchantCity: qr.merchantCity,
      countryCode: qr.countryCode,
      currencyNumeric: qr.currencyNumeric,
      amountTzs: qr.amountTzs,
      merchantCategoryCode: qr.merchantCategoryCode,
      reference: qr.reference,
      // Read off a real code rather than assumed — see KNOWN_SCHEMES.
      scheme: qr.scheme,
      schemeLabel: qr.schemeLabel,
      merchantIdentifier: qr.merchantIdentifier,
      acquirerIdentifier: qr.acquirerIdentifier,
      accounts: qr.accounts,
      candidateTillNumbers: qr.candidateTillNumbers,
    },
    attempts,
    resolution: resolved ? 'resolved' : hits.length > 1 ? 'ambiguous' : 'unresolved',
    payNumber: resolved?.payNumber ?? null,
    merchantName: resolved?.name ?? null,
    nameMatch: resolved ? qrNameAgrees(qr.merchantName, resolved.name) : null,
  })
}
