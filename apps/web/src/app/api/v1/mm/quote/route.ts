import { NextRequest, NextResponse } from 'next/server'
import { authenticateMM } from '@/lib/fx/auth'
import { getDb } from '@/lib/db'
import { lpFxConfig } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { SWAP_TOKENS } from '@/lib/fx/swap'

export async function GET(request: NextRequest) {
  const authResult = await authenticateMM(request)
  if ('error' in authResult) return authResult.error

  const { mm } = authResult
  const { searchParams } = new URL(request.url)

  const fromToken = searchParams.get('fromToken')?.toUpperCase()
  const toToken = searchParams.get('toToken')?.toUpperCase()
  const amountStr = searchParams.get('amount')
  const slippageBps = parseInt(searchParams.get('slippageBps') ?? '100', 10)

  if (!fromToken || !toToken || !amountStr) {
    return NextResponse.json({ error: 'fromToken, toToken, and amount are required' }, { status: 400 })
  }
  if (fromToken === toToken) {
    return NextResponse.json({ error: 'fromToken and toToken must differ' }, { status: 400 })
  }
  if (!SWAP_TOKENS[fromToken as keyof typeof SWAP_TOKENS] || !SWAP_TOKENS[toToken as keyof typeof SWAP_TOKENS]) {
    return NextResponse.json({ error: `Supported tokens: ${Object.keys(SWAP_TOKENS).join(', ')}` }, { status: 400 })
  }

  const amount = parseFloat(amountStr)
  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  const { db } = getDb()
  const [config] = await db.select().from(lpFxConfig).where(eq(lpFxConfig.id, 1)).limit(1)
  const midRate = config?.midRateTZS ?? 3750

  const toNtzs = toToken === 'NTZS'
  const spreadBps = toNtzs ? mm.askBps : mm.bidBps
  // Stablecoin→nTZS: user buys nTZS at ask (LP sells high → user gets fewer nTZS)
  // nTZS→Stablecoin: user sells nTZS at bid (LP buys low → user gets fewer stablecoin)
  const effectiveRate = toNtzs
    ? midRate * (1 - spreadBps / 10000)
    : (1 / midRate) * (1 - spreadBps / 10000)

  const rawOut = toNtzs ? amount * midRate : amount / midRate
  const minAmountOut = rawOut * (1 - (spreadBps + slippageBps) / 10000)

  return NextResponse.json({
    fromToken,
    toToken,
    amountIn: amount.toString(),
    minAmountOut: minAmountOut.toFixed(6),
    effectiveRate: effectiveRate.toFixed(6),
    midRate,
    spreadBps,
    slippageBps,
    protocolFeeBps: 10,
  })
}
