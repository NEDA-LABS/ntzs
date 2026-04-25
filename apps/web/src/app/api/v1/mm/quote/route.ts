import { NextRequest, NextResponse } from 'next/server'
import { authenticateMM } from '@/lib/fx/auth'
import { getDb } from '@/lib/db'
import { lpFxConfig } from '@ntzs/db'
import { eq } from 'drizzle-orm'

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
  if (!['NTZS', 'USDC'].includes(fromToken) || !['NTZS', 'USDC'].includes(toToken)) {
    return NextResponse.json({ error: 'Supported tokens: NTZS, USDC' }, { status: 400 })
  }

  const amount = parseFloat(amountStr)
  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  const { db } = getDb()
  const [config] = await db.select().from(lpFxConfig).where(eq(lpFxConfig.id, 1)).limit(1)
  const midRate = config?.midRateTZS ?? 3750

  const spreadBps = fromToken === 'USDC' ? mm.askBps : mm.bidBps
  // USDC→nTZS: user buys nTZS at ask (LP sells high → user gets fewer nTZS)
  // nTZS→USDC: user sells nTZS at bid (LP buys low → user gets fewer USDC)
  const effectiveRate = fromToken === 'USDC'
    ? midRate * (1 - spreadBps / 10000)
    : (1 / midRate) * (1 - spreadBps / 10000)

  const rawOut = fromToken === 'USDC' ? amount * midRate : amount / midRate
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
