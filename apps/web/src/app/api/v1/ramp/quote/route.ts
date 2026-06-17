import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { rampQuotes } from '@ntzs/db'
import { requireRampPartner } from '@/lib/ramp/auth'
import { computeRampQuote, RAMP_QUOTE_TTL_MS, type RampDirection } from '@/lib/ramp/quote'

export const runtime = 'nodejs'

/**
 * POST /api/v1/ramp/quote
 *
 * Body: { direction: 'offramp' | 'onramp', usdcAmount?, tzsAmount? }
 *   - offramp: pass usdcAmount (USDC to spend) → recipient TZS net.
 *   - onramp:  pass tzsAmount (TZS to collect) → USDC delivered.
 *
 * Returns a locked quote (rate held until expiresAt) the partner consumes when
 * initiating an off/on-ramp settlement.
 */
export async function POST(req: NextRequest) {
  const auth = await requireRampPartner(req)
  if ('error' in auth) return auth.error

  let body: { direction?: RampDirection; usdcAmount?: number; tzsAmount?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { direction, usdcAmount, tzsAmount } = body
  if (direction !== 'offramp' && direction !== 'onramp') {
    return NextResponse.json({ error: "direction must be 'offramp' or 'onramp'" }, { status: 400 })
  }

  const quote = await computeRampQuote({ direction, usdcAmount, tzsAmount })
  if ('error' in quote) return NextResponse.json({ error: quote.error }, { status: 400 })

  if (quote.lowLiquidity) {
    return NextResponse.json(
      { error: 'Insufficient liquidity to settle this amount right now. Try a smaller amount or retry shortly.' },
      { status: 503 },
    )
  }

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
    expiresAt: expiresAt.toISOString(),
  })
}
