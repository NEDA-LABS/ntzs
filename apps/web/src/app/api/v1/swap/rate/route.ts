import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { getDb } from '@/lib/db'
import { lpFxPairs, lpAccounts, lpFills } from '@ntzs/db'
import { eq, inArray, sql } from 'drizzle-orm'
import { calcMinOutput, selectLPForSwap, SWAP_TOKENS, type SwapTokenSymbol, type LPConfig } from '@/lib/fx/swap'
import { getChainToken, type ChainId } from '@/lib/fx/chainConfig'

export const runtime = 'nodejs'

/**
 * GET /api/v1/swap/rate?from=USDC&to=NTZS&amount=5&fromChain=base&toChain=base
 *
 * Returns the current expected output for a swap, based on active
 * pair mid-rate and the average LP spread.  Public endpoint — no auth.
 * fromChain/toChain default to 'base'; only matters for USDT (Base vs BNB).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const from = (searchParams.get('from') ?? '').toUpperCase() as SwapTokenSymbol
  const to = (searchParams.get('to') ?? '').toUpperCase() as SwapTokenSymbol
  const amount = parseFloat(searchParams.get('amount') ?? '0')
  const fromChain = (searchParams.get('fromChain') ?? 'base') as ChainId
  const toChain   = (searchParams.get('toChain')   ?? 'base') as ChainId

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

  // Resolve chain-correct addresses (falls back to SWAP_TOKENS default for tokens that only exist on Base)
  const tokenAddressFor = (sym: SwapTokenSymbol, chain: ChainId) => {
    try {
      return getChainToken(chain, sym).address.toLowerCase()
    } catch {
      return SWAP_TOKENS[sym].address.toLowerCase()
    }
  }

  const fromAddr = tokenAddressFor(from, fromChain)
  const toAddr   = tokenAddressFor(to, toChain)

  const pair = pairs.find(
    (p: typeof pairs[number]) =>
      (p.token1Address.toLowerCase() === fromAddr || p.token2Address.toLowerCase() === fromAddr) &&
      (p.token1Address.toLowerCase() === toAddr   || p.token2Address.toLowerCase() === toAddr)
  )

  if (!pair) {
    return NextResponse.json({ error: 'No active pair found for this token combination' }, { status: 404 })
  }

  const midRate = parseFloat(pair.midRate.toString())

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

  // Liquidity check against the chain-correct solver wallet
  let lowLiquidity = false
  const outputChain = to === 'NTZS' ? 'base' : toChain
  const solverAddress = outputChain === 'bnb'
    ? (process.env.BNB_SOLVER_ADDRESS ?? process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646')
    : (process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646')
  const rpcUrl = outputChain === 'bnb' ? process.env.BNB_RPC_URL : process.env.BASE_RPC_URL

  if (rpcUrl) {
    try {
      const outTokenAddress = tokenAddressFor(to, toChain)
      const outTokenDecimals = (() => {
        try { return getChainToken(toChain, to).decimals } catch { return SWAP_TOKENS[to].decimals }
      })()
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(outTokenAddress, ['function balanceOf(address) view returns (uint256)'], provider)
      const balance: bigint = await contract.balanceOf(solverAddress)
      const balanceFormatted = parseFloat(ethers.formatUnits(balance, outTokenDecimals))
      lowLiquidity = balanceFormatted < minOutput
    } catch {
      // If check fails, don't block the rate — swap will catch it
    }
  }

  return NextResponse.json({
    from,
    to,
    fromChain,
    toChain,
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
