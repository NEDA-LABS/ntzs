import { NextRequest, NextResponse } from 'next/server'
import { eq, and, isNull, gt } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { rampQuotes, rampSettlements } from '@ntzs/db'
import { requireRampPartner } from '@/lib/ramp/auth'
import { getOrCreateSettlementWallet } from '@/lib/ramp/wallet'
import { runOfframpSettlement } from '@/lib/ramp/offramp'
import { rampSpendEnabled } from '@/lib/ramp/quote'
import { withIdempotency, getIdempotencyKey } from '@/lib/idempotency'
import { isValidTanzanianPhone } from '@/lib/psp'
import { enforceSandboxLimits, limitErrorResponse, rampCounterpartySubject } from '@/lib/sandbox/limits'
import { payoutRailsLookDead, CIRCUIT_OPEN_RESPONSE } from '@/lib/psp/payout-circuit'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST /api/v1/ramp/offramp
 * Body: { quoteId, phoneNumber }
 *
 * Consumes an off-ramp quote: swaps the partner's USDC float → nTZS, burns it,
 * and pays the recipient mobile money. Idempotent via the Idempotency-Key header.
 */
export async function POST(req: NextRequest) {
  try {
    return await handleOfframp(req)
  } catch (err) {
    // withIdempotency releases its claim on a throw, so a clean retry stays
    // possible — but the partner used to see only an opaque 500. The
    // settlement engine records its own failures; this catches what escapes.
    const requestId = crypto.randomUUID()
    console.error(`[v1/ramp/offramp] ${requestId}`, err instanceof Error ? (err.stack ?? err.message) : err)
    return NextResponse.json(
      { error: 'ramp_unavailable', message: 'The ramp service hit an internal error. Check GET /api/v1/ramp/settlements before retrying, and contact NEDA Labs quoting the requestId.', requestId },
      { status: 503 },
    )
  }
}

async function handleOfframp(req: NextRequest) {
  const auth = await requireRampPartner(req)
  if ('error' in auth) return auth.error
  const { partner } = auth

  let body: { quoteId?: string; phoneNumber?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { quoteId, phoneNumber } = body
  if (!quoteId) return NextResponse.json({ error: 'quoteId is required' }, { status: 400 })

  return withIdempotency(`ramp_offramp:${partner.id}`, getIdempotencyKey(req), async () => {
    const { db } = getDb()

    // Atomically consume the quote: must belong to this partner, be an off-ramp,
    // unconsumed, and unexpired.
    const [quote] = await db
      .update(rampQuotes)
      .set({ consumedAt: new Date() })
      .where(and(
        eq(rampQuotes.id, quoteId),
        eq(rampQuotes.partnerId, partner.id),
        eq(rampQuotes.direction, 'offramp'),
        isNull(rampQuotes.consumedAt),
        gt(rampQuotes.expiresAt, new Date()),
      ))
      .returning()

    if (!quote) {
      return NextResponse.json({ error: 'Quote not found, already used, expired, or not an off-ramp quote' }, { status: 409 })
    }

    // The destination is bound to the quote (priced + name-disclosed there).
    // Wallet payout still takes the phone at execute time; lipa/bill do not.
    const destination = (quote.destination as
      | { kind: 'lipa'; payNumber: string; network?: string; recipientName?: string | null }
      | { kind: 'bill'; utilityCode: string; utilityRef: string; recipientName?: string | null }
      | null) ?? { kind: 'wallet' as const }

    if (destination.kind === 'wallet') {
      if (!phoneNumber) return NextResponse.json({ error: 'phoneNumber is required for a wallet off-ramp' }, { status: 400 })
      if (!isValidTanzanianPhone(phoneNumber)) return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })
    } else if (!rampSpendEnabled()) {
      // Defense in depth: a lipa/bill quote can only be minted while the flag
      // is on, but refuse execution too if it was switched off since.
      return NextResponse.json({ error: 'ramp_spend_disabled', message: 'Lipa/bill off-ramp destinations are not enabled yet (pending regulatory approval).' }, { status: 503 })
    }

    // Circuit breaker (wallet payouts only — lipa/bill ride the spend rail):
    // when disbursement initiations are evidently being refused, fail before
    // the swap/burn instead of stranding a settlement. Quote spent, nothing
    // moved.
    if (destination.kind === 'wallet') {
      const circuit = await payoutRailsLookDead()
      if (circuit.dead) {
        console.warn('[v1/ramp/offramp] circuit open — refusing pre-swap:', circuit.reason)
        return NextResponse.json(CIRCUIT_OPEN_RESPONSE, { status: 503 })
      }
    }

    // BoT Parameters #3/#4/#5 at the point of execution, counted per
    // TANZANIAN-SIDE WALLET — the till, bill account or mobile wallet being
    // paid (a per-wallet limit, not a platform one). For wallet payouts this
    // is the first point the phone is known, so it is where the period caps
    // can bind. A block spends the consumed quote, but nothing has moved and
    // quotes are 60-second ephemera. Gross leg = recipient net + fee.
    const cp =
      destination.kind === 'lipa'
        ? rampCounterpartySubject({ kind: 'lipa', payNumber: destination.payNumber })
        : destination.kind === 'bill'
          ? rampCounterpartySubject({ kind: 'bill', utilityCode: destination.utilityCode, utilityRef: destination.utilityRef })
          : rampCounterpartySubject({ kind: 'phone', phone: phoneNumber! })
    const limitErr = await enforceSandboxLimits(
      cp,
      quote.tzsAmount + quote.feeTzs,
      { endpoint: 'v1/ramp/offramp', stage: 'execute', partnerId: partner.id },
    )
    if (limitErr) return NextResponse.json(limitErrorResponse(limitErr), { status: 400 })

    // Self-provisions the seed for a first-time ramp partner (see wallet.ts).
    const wallet = await getOrCreateSettlementWallet(partner.id)

    const [settlement] = await db.insert(rampSettlements).values({
      partnerId: partner.id,
      direction: 'offramp',
      status: 'processing',
      quoteId: quote.id,
      rateUsdTzs: quote.rateUsdTzs,
      usdcAmount: quote.usdcAmount,
      tzsAmount: quote.tzsAmount,
      feeTzs: quote.feeTzs,
      recipientPhone: destination.kind === 'wallet' ? phoneNumber : null,
      destination: destination.kind === 'wallet' ? null : destination,
      idempotencyKey: getIdempotencyKey(req),
    }).returning()

    const result = await runOfframpSettlement({
      partnerId: partner.id,
      settlementId: settlement.id,
      settlementAddress: wallet.address,
      settlementWalletIndex: wallet.walletIndex,
      encryptedHdSeed: wallet.encryptedHdSeed,
      usdcAmount: Number(quote.usdcAmount),
      recipientTzs: quote.tzsAmount,
      feeTzs: quote.feeTzs,
      recipientPhone: destination.kind === 'wallet' ? phoneNumber : undefined,
      destination,
    })

    const status = result.status === 'completed' ? 201
      : result.status === 'paying_out' ? 202
      : result.status === 'reverted' ? 502
      : 400

    return NextResponse.json({
      settlementId: settlement.id,
      status: result.status,
      usdcAmount: Number(quote.usdcAmount),
      tzsAmount: quote.tzsAmount,
      ...(destination.kind === 'wallet'
        ? { recipientPhone: phoneNumber }
        : { destination: destination.kind === 'lipa' ? { kind: 'lipa', payNumber: destination.payNumber } : { kind: 'bill', utilityCode: destination.utilityCode, utilityRef: destination.utilityRef }, recipientName: destination.recipientName ?? null }),
      ...(result.error ? { error: result.error } : {}),
    }, { status })
  })
}
