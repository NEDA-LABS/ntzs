import { NextRequest, NextResponse } from 'next/server'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { isAddress } from 'ethers'

import { getDb } from '@/lib/db'
import { rampQuotes, rampSettlements } from '@ntzs/db'
import { requireRampPartner } from '@/lib/ramp/auth'
import { getOrCreateSettlementWallet } from '@/lib/ramp/wallet'
import { initiateOnramp } from '@/lib/ramp/onramp'
import { withIdempotency, getIdempotencyKey } from '@/lib/idempotency'
import { isValidTanzanianPhone } from '@/lib/psp'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/v1/ramp/onramp
 * Body: { quoteId, phoneNumber, destinationAddress? }
 *
 * Consumes an on-ramp quote: prompts the payer's phone for mobile money; once
 * paid + minted, the ramp-settle cron swaps nTZS→USDC and delivers it (to
 * destinationAddress, else the partner's settlement float). Idempotent.
 */
export async function POST(req: NextRequest) {
  const auth = await requireRampPartner(req)
  if ('error' in auth) return auth.error
  const { partner } = auth

  let body: { quoteId?: string; phoneNumber?: string; destinationAddress?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { quoteId, phoneNumber, destinationAddress } = body
  if (!quoteId || !phoneNumber) return NextResponse.json({ error: 'quoteId and phoneNumber are required' }, { status: 400 })
  if (!isValidTanzanianPhone(phoneNumber)) return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })
  if (destinationAddress && !isAddress(destinationAddress)) return NextResponse.json({ error: 'Invalid destinationAddress' }, { status: 400 })

  return withIdempotency(`ramp_onramp:${partner.id}`, getIdempotencyKey(req), async () => {
    const { db } = getDb()

    const [quote] = await db
      .update(rampQuotes)
      .set({ consumedAt: new Date() })
      .where(and(
        eq(rampQuotes.id, quoteId),
        eq(rampQuotes.partnerId, partner.id),
        eq(rampQuotes.direction, 'onramp'),
        isNull(rampQuotes.consumedAt),
        gt(rampQuotes.expiresAt, new Date()),
      ))
      .returning()

    if (!quote) {
      return NextResponse.json({ error: 'Quote not found, already used, expired, or not an on-ramp quote' }, { status: 409 })
    }

    const wallet = await getOrCreateSettlementWallet(partner.id)

    const [settlement] = await db.insert(rampSettlements).values({
      partnerId: partner.id,
      direction: 'onramp',
      status: 'minting',
      quoteId: quote.id,
      rateUsdTzs: quote.rateUsdTzs,
      usdcAmount: quote.usdcAmount,
      tzsAmount: quote.tzsAmount,
      feeTzs: quote.feeTzs,
      recipientPhone: phoneNumber,
      destinationAddress: destinationAddress ?? null,
      idempotencyKey: getIdempotencyKey(req),
    }).returning()

    const result = await initiateOnramp({
      partnerId: partner.id,
      settlementId: settlement.id,
      settlementAddress: wallet.address,
      tzsAmount: quote.tzsAmount,
      payerPhone: phoneNumber,
    })

    if (!result.ok) {
      return NextResponse.json({ settlementId: settlement.id, status: 'failed', error: result.error }, { status: 502 })
    }

    return NextResponse.json({
      settlementId: settlement.id,
      status: 'minting',
      tzsAmount: quote.tzsAmount,
      usdcAmount: Number(quote.usdcAmount),
      destinationAddress: destinationAddress ?? null,
      message: 'Mobile-money prompt sent to the payer. USDC is delivered once payment is confirmed and minted.',
    }, { status: 202 })
  })
}
