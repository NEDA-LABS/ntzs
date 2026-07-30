import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { eq } from 'drizzle-orm'

import { partners, rampQuotes } from '@ntzs/db'
import { requireRampPartner } from '@/lib/ramp/auth'
import { computeRampQuote, RAMP_QUOTE_TTL_MS, rampSpendEnabled, type RampDirection, type RampOfframpDestination } from '@/lib/ramp/quote'
import { nedaAccountLookup } from '@/lib/psp/selcom'
import { getBiller, validateUtilityRef, SELCOM_BILLERS } from '@/lib/psp/selcom-billers'
import { spendKindEnabled } from '@/lib/waas/spend-quote'

// Biller name validation goes upstream to the utility and can take ~25s
// (see nedaAccountLookup). Without this the platform default would kill the
// route before its own lookup answers.
export const maxDuration = 60

export const runtime = 'nodejs'

/**
 * POST /api/v1/ramp/quote
 *
 * Body: { direction: 'offramp' | 'onramp', usdcAmount?, tzsAmount?, destination? }
 *   - offramp: pass usdcAmount (USDC to spend) → recipient TZS net.
 *   - onramp:  pass tzsAmount (TZS to collect) → USDC delivered.
 *   - destination (off-ramp only): where the TZS goes.
 *       omitted / { kind:'wallet' } → mobile-money payout (default)
 *       { kind:'lipa', payNumber, network? } → merchant Lipa Namba
 *       { kind:'bill', utilityCode, utilityRef } → biller (LUKU, GEPG, …)
 *
 * For lipa/bill the response includes the destination's registered name so the
 * partner can show "Paying: ENZI COFFEE" before consuming the quote. The
 * destination is BOUND to the quote — the off-ramp executes exactly it.
 */
export async function POST(req: NextRequest) {
  const auth = await requireRampPartner(req)
  if ('error' in auth) return auth.error

  let body: {
    direction?: RampDirection
    usdcAmount?: number
    tzsAmount?: number
    destination?: { kind?: string; payNumber?: string; network?: string; utilityCode?: string; utilityRef?: string }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { direction, usdcAmount, tzsAmount } = body
  if (direction !== 'offramp' && direction !== 'onramp') {
    return NextResponse.json({ error: "direction must be 'offramp' or 'onramp'" }, { status: 400 })
  }

  // ── Resolve + validate the off-ramp destination (spend rails) ─────────────
  let destination: RampOfframpDestination = { kind: 'wallet' }
  let recipientName: string | null = null
  const rawKind = body.destination?.kind
  if (direction === 'offramp' && rawKind && rawKind !== 'wallet') {
    // Dedicated, BoT-gated switch — independent of the (already-live) domestic
    // spend gate, so cross-border merchant/bill off-ramps stay dark until BoT
    // green-lights them, whatever the migration / domestic-spend state.
    if (!rampSpendEnabled()) {
      return NextResponse.json({ error: 'ramp_spend_disabled', message: 'Lipa/bill off-ramp destinations are not enabled yet (pending regulatory approval).' }, { status: 503 })
    }
    if (rawKind !== 'lipa' && rawKind !== 'bill') {
      return NextResponse.json({ error: "destination.kind must be 'wallet', 'lipa' or 'bill'" }, { status: 400 })
    }
    if (!spendKindEnabled(rawKind)) {
      return NextResponse.json({ error: 'spend_kind_disabled', message: `The ${rawKind} rail is not enabled on this environment yet.` }, { status: 503 })
    }

    if (rawKind === 'lipa') {
      const payNumber = String(body.destination?.payNumber ?? '').replace(/\s+/g, '')
      if (!/^\d{4,12}$/.test(payNumber)) {
        return NextResponse.json({ error: 'destination.payNumber must be the merchant Lipa Namba (4–12 digits)' }, { status: 400 })
      }
      const network = body.destination?.network?.trim() || undefined
      destination = { kind: 'lipa', payNumber, ...(network ? { network } : {}) }
      const info = await nedaAccountLookup('SB2LIPA', payNumber).catch(() => ({ name: null as string | null }))
      recipientName = info.name
    } else {
      const utilityCode = String(body.destination?.utilityCode ?? '').trim().toUpperCase()
      const utilityRef = String(body.destination?.utilityRef ?? '').trim()
      const biller = getBiller(utilityCode)
      if (!biller) {
        return NextResponse.json({ error: 'unknown_biller', message: `utilityCode '${utilityCode}' is not in the catalogue.`, supportedCodes: SELCOM_BILLERS.map((b) => b.code) }, { status: 400 })
      }
      const refCheck = validateUtilityRef(utilityCode, utilityRef)
      if (!refCheck.ok) return NextResponse.json({ error: 'invalid_utility_ref', message: refCheck.reason }, { status: 400 })
      destination = { kind: 'bill', utilityCode, utilityRef }
      // The TZS amount is derived from the rate later, so validate the name
      // with the biller minimum — the lookup is for the owner's name, and
      // 1,000 is the floor LUKU itself stated when probed without an amount.
      const info = await nedaAccountLookup(utilityCode, utilityRef, { amountTzs: 1000 }).catch(() => ({ name: null as string | null }))
      recipientName = info.name
    }
  }

  // The partner's negotiated margin. Ramp pricing used to be a hard-coded
  // 0.5% regardless of the partner row, so a rate agreed commercially had no
  // effect on what was actually charged. Resolved the same way spend and
  // withdrawal quotes resolve it, so one partner cannot be priced differently
  // by different products.
  const { db: pricingDb } = getDb()
  const [partnerRow] = await pricingDb
    .select({ feePercent: partners.feePercent })
    .from(partners)
    .where(eq(partners.id, auth.partner.id))
    .limit(1)
  const feePercent = partnerRow ? parseFloat(String(partnerRow.feePercent ?? '0')) : 0

  const quote = await computeRampQuote({ direction, usdcAmount, tzsAmount, destination, feePercent })
  if ('error' in quote) return NextResponse.json({ error: quote.error }, { status: 400 })

  if (quote.lowLiquidity) {
    return NextResponse.json(
      { error: 'Insufficient liquidity to settle this amount right now. Try a smaller amount or retry shortly.' },
      { status: 503 },
    )
  }

  // Store the destination (+ resolved name) on the quote so the off-ramp
  // executes exactly what was priced and disclosed.
  const storedDestination =
    destination.kind === 'wallet' ? null : { ...destination, recipientName }

  const expiresAt = new Date(Date.now() + RAMP_QUOTE_TTL_MS)
  const { db } = getDb()
  const [row] = await db
    .insert(rampQuotes)
    .values({
      partnerId: auth.partner.id,
      direction,
      rateUsdTzs: quote.rateUsdTzs.toString(),
      usdcAmount: quote.usdcAmount.toString(),
      tzsAmount: quote.tzsAmount,
      feeTzs: quote.feeTzs,
      destination: storedDestination,
      expiresAt,
    })
    .returning({ id: rampQuotes.id })

  return NextResponse.json({
    quoteId: row.id,
    direction,
    usdcAmount: quote.usdcAmount,
    tzsAmount: quote.tzsAmount,
    feeTzs: quote.feeTzs,
    rateUsdTzs: quote.rateUsdTzs,
    ...(destination.kind !== 'wallet'
      ? { destination: destination.kind === 'lipa' ? { kind: 'lipa', payNumber: destination.payNumber, network: destination.network ?? null } : { kind: 'bill', utilityCode: destination.utilityCode, utilityRef: destination.utilityRef }, recipientName }
      : {}),
    expiresAt: expiresAt.toISOString(),
  })
}
