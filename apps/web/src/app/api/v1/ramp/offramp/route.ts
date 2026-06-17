import { NextRequest, NextResponse } from 'next/server'
import { eq, and, isNull, gt } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { rampQuotes, rampSettlements } from '@ntzs/db'
import { requireRampPartner } from '@/lib/ramp/auth'
import { getOrCreateSettlementWallet } from '@/lib/ramp/wallet'
import { runOfframpSettlement } from '@/lib/ramp/offramp'
import { withIdempotency, getIdempotencyKey } from '@/lib/idempotency'
import { isValidTanzanianPhone } from '@/lib/psp'

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
  const auth = await requireRampPartner(req)
  if ('error' in auth) return auth.error
  const { partner } = auth

  let body: { quoteId?: string; phoneNumber?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { quoteId, phoneNumber } = body
  if (!quoteId || !phoneNumber) return NextResponse.json({ error: 'quoteId and phoneNumber are required' }, { status: 400 })
  if (!isValidTanzanianPhone(phoneNumber)) return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })

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

    if (!partner.encryptedHdSeed) {
      return NextResponse.json({ error: 'Partner HD seed not configured' }, { status: 400 })
    }

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
      recipientPhone: phoneNumber,
      idempotencyKey: getIdempotencyKey(req),
    }).returning()

    const result = await runOfframpSettlement({
      partnerId: partner.id,
      settlementId: settlement.id,
      settlementAddress: wallet.address,
      settlementWalletIndex: wallet.walletIndex,
      encryptedHdSeed: partner.encryptedHdSeed,
      usdcAmount: Number(quote.usdcAmount),
      recipientTzs: quote.tzsAmount,
      feeTzs: quote.feeTzs,
      recipientPhone: phoneNumber,
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
      recipientPhone: phoneNumber,
      ...(result.error ? { error: result.error } : {}),
    }, { status })
  })
}
