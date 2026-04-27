import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { getDb } from '@/lib/db'
import { lpFxPairs, lpAccounts, lpFills } from '@ntzs/db'
import { eq, inArray, sql } from 'drizzle-orm'
import { calcMinOutput, selectLPForSwap, SWAP_TOKENS, type SwapTokenSymbol, type LPConfig } from '@/lib/fx/swap'

export const runtime = 'nodejs'

/**
 * GET /api/v1/swap/rate?from=USDC&to=NTZS&amount=5
 *
 * Returns the current expected output for a swap, based on active
 * pair mid-rate and the average LP spread.  Public endpoint — no auth.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const from = (searchParams.get('from') ?? '').toUpperCase() as SwapTokenSymbol
  const to = (searchParams.get('to') ?? '').toUpperCase() as SwapTokenSymbol
  const amount = parseFloat(searchParams.get('amount') ?? '0')

  if (!from || !to || from === to) {
    return NextResponse.json({ error: 'from and to are required and must differ' }, { status: 400 })
  }
  if (!amount || isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  const { db } = getDb()

  const pairs = await db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)).limit(10)

  if (!SWAP_TOKENS[from] || !SWAP_TOKENS[to]) {
    return NextResponse.json({ error: `Unsupported tokens. Valid: ${Object.keys(SWAP_TOKENS).join(', ')}` }, { status: 400 })
  }

  const tokenAddressFor = (sym: SwapTokenSymbol) => SWAP_TOKENS[sym].address.toLowerCase()

  const pair = pairs.find(
    (p: typeof pairs[number]) =>
      (p.token1Address.toLowerCase() === tokenAddressFor(from) ||
        p.token2Address.toLowerCase() === tokenAddressFor(from)) &&
      (p.token1Address.toLowerCase() === tokenAddressFor(to) ||
        p.token2Address.toLowerCase() === tokenAddressFor(to))
  )

  if (!pair) {
    return NextResponse.json({ error: 'No active pair found for this token combination' }, { status: 404 })
  }

  const midRate = parseFloat(pair.midRate.toString())

  // Pick LP using same load-balanced logic as the swap route, so the
  // displayed rate matches the LP that will actually fill.
  const activeLPs = await db
    .select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true as unknown as boolean))

  let bidBps = 120
  let askBps = 150
  if (activeLPs.length > 0) {
    const lpConfigs: LPConfig[] = activeLPs.map((lp) => ({
      id: lp.id,
      bidBps: lp.bidBps ?? 120,
      askBps: lp.askBps ?? 150,
    }))
    const lastFillRows = await db
      .select({ lpId: lpFills.lpId, lastAt: sql<Date>`max(${lpFills.createdAt})` })
      .from(lpFills)
      .where(inArray(lpFills.lpId, lpConfigs.map((lp) => lp.id)))
      .groupBy(lpFills.lpId)
    const lastFillTimes = new Map<string, number>(
      lastFillRows.map((r) => [r.lpId, r.lastAt ? new Date(r.lastAt).getTime() : 0]),
    )
    const direction = to === 'NTZS' ? 'STABLE_TO_NTZS' : 'NTZS_TO_STABLE'
    const bestLP = selectLPForSwap(lpConfigs, direction, lastFillTimes)
    bidBps = bestLP.bidBps
    askBps = bestLP.askBps
  }

  const expectedOutput = calcMinOutput({
    fromToken: from,
    toToken: to,
    amount,
    midRate,
    bidBps,
    askBps,
    slippageBps: 0,
  })

  const minOutput = calcMinOutput({
    fromToken: from,
    toToken: to,
    amount,
    midRate,
    bidBps,
    askBps,
    slippageBps: 100,
  })

  // Check solver pool liquidity for the output token.
  // Only flag lowLiquidity when the pool genuinely can't cover minOutput
  // (expectedOutput with 1% slippage already baked in).
  // Previously used expectedOutput * 1.1 which caused false positives for
  // valid swaps — the actual execution only needs minOutput, not 110%.
  let lowLiquidity = false
  const solverAddress = process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646'
  const rpcUrl = process.env.BASE_RPC_URL
  if (rpcUrl) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const outToken = SWAP_TOKENS[to]
      const contract = new ethers.Contract(outToken.address, ['function balanceOf(address) view returns (uint256)'], provider)
      const balance: bigint = await contract.balanceOf(solverAddress)
      const balanceFormatted = parseFloat(ethers.formatUnits(balance, outToken.decimals))
      lowLiquidity = balanceFormatted < minOutput
    } catch {
      // If check fails, don't block the rate — swap will catch it
    }
  }

  return NextResponse.json({
    from,
    to,
    amount,
    midRate,
    bidBps,
    askBps,
    expectedOutput: +expectedOutput.toFixed(6),
    minOutput: +minOutput.toFixed(6),
    rate: +(expectedOutput / amount).toFixed(6),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    lowLiquidity,
  })
}
