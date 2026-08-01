import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { getDb } from '@/lib/db'
import { lpFxPairs, lpAccounts, lpFills, lpPoolPositions } from '@ntzs/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { calcMinOutput, selectLPForSwap, filterLPsByInventory, SWAP_TOKENS, type SwapTokenSymbol, type LPConfig } from '@/lib/fx/swap'
import { getChainToken, type ChainId } from '@/lib/fx/chainConfig'
import { PLATFORM_FX_FEE_BPS } from '@/lib/env'

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
  // Same chain logic as the swap route: cross-chain swaps use the stablecoin's chain
  const stablecoinChain = from === 'NTZS' ? toChain : fromChain

  console.log('[rate] pair search', { from, to, fromChain, toChain, fromAddr, toAddr, stablecoinChain, totalPairs: pairs.length })

  const pair = pairs.find(
    (p: typeof pairs[number]) => {
      const p1 = p.token1Address.toLowerCase()
      const p2 = p.token2Address.toLowerCase()
      const addressMatch = (p1 === fromAddr || p2 === fromAddr) && (p1 === toAddr || p2 === toAddr)
      const chainMatch = fromChain === toChain ? p.chain === fromChain : p.chain === stablecoinChain
      return addressMatch && chainMatch
    }
  )

  console.log('[rate] pair found', pair ? { id: pair.id, chain: pair.chain, midRate: pair.midRate, t1: pair.token1Address, t2: pair.token2Address } : null)

  if (!pair) {
    return NextResponse.json({ error: 'No active pair found for this token combination' }, { status: 404 })
  }

  const midRate = parseFloat(pair.midRate.toString())
  console.log('[rate] midRate parsed', midRate)

  const activeLPs = await db
    .select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true as unknown as boolean))

  let bidBps = 120
  let askBps = 150
  let noCoveredLp = false
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

    // Mirror the execute route's inventory-aware selection: quote the LP that
    // would actually fill. Quoting a thin LP's spread and then executing
    // against a different (covered) LP would show the user one rate and
    // deliver another.
    const midOutput = to === 'NTZS' ? amount * midRate : amount / midRate
    const outPositions = await db
      .select({ lpId: lpPoolPositions.lpId, contributed: lpPoolPositions.contributed })
      .from(lpPoolPositions)
      .where(and(
        eq(lpPoolPositions.chain, toChain),
        eq(lpPoolPositions.tokenAddress, toAddr),
        inArray(lpPoolPositions.lpId, lpConfigs.map((lp) => lp.id)),
      ))
    const inventoryByLpId = new Map(outPositions.map((p) => [p.lpId, parseFloat(p.contributed)]))
    const coveredLPs = filterLPsByInventory(lpConfigs, inventoryByLpId, midOutput)

    // No LP can cover this size: still quote off the best spread so the UI has
    // a rate to show, but flag the quote — execution would refuse.
    if (coveredLPs.length === 0) noCoveredLp = true
    const bestLP = selectLPForSwap(coveredLPs.length ? coveredLPs : lpConfigs, direction, lastFillTimes)
    bidBps = bestLP.bidBps
    askBps = bestLP.askBps
  }

  // Quote the post-fee output so the displayed rate matches what the swap
  // actually delivers (the protocol fee is charged on top of the LP spread).
  const expectedOutput = calcMinOutput({
    fromToken: from,
    toToken: to,
    amount,
    midRate,
    bidBps,
    askBps,
    slippageBps: 0,
    protocolFeeBps: PLATFORM_FX_FEE_BPS,
  })

  const minOutput = calcMinOutput({
    fromToken: from,
    toToken: to,
    amount,
    midRate,
    bidBps,
    askBps,
    slippageBps: 100,
    protocolFeeBps: PLATFORM_FX_FEE_BPS,
  })

  // Liquidity check against the chain-correct solver wallet
  let lowLiquidity = false
  const outputChain = to === 'NTZS' ? 'base' : toChain
  const hasBnbSolver = !!process.env.BNB_SOLVER_ADDRESS
  const solverAddress = outputChain === 'bnb'
    ? (process.env.BNB_SOLVER_ADDRESS ?? process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646')
    : (process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646')
  const rpcUrl = outputChain === 'bnb' ? process.env.BNB_RPC_URL : process.env.BASE_RPC_URL

  console.log('[rate] liquidity check', { outputChain, solverAddress, hasBnbSolver, hasRpc: !!rpcUrl, expectedOutput: +expectedOutput.toFixed(6), minOutput: +minOutput.toFixed(6) })

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
      console.log('[rate] solver balance', { solverAddress, outTokenAddress, outTokenDecimals, balanceFormatted, minOutput: +minOutput.toFixed(6), lowLiquidity: balanceFormatted < minOutput })
      lowLiquidity = balanceFormatted < minOutput
    } catch (err) {
      console.error('[rate] liquidity check failed', err)
    }
  }

  // The quoted LP's board rates in nTZS-per-stablecoin terms, matching the
  // user-perspective BUY/SELL convention of consumer rate tickers:
  //   tzsBuyRate  — nTZS the user RECEIVES per 1 stablecoin (LP sells nTZS at its ask)
  //   tzsSellRate — nTZS the user PAYS for 1 stablecoin    (LP buys nTZS at its bid)
  // Spread only — the platform fee (protocolFeeBps) is charged on top and is
  // already inside expectedOutput/rate.
  const tzsBuyRate = midRate * (1 - askBps / 10000)
  const tzsSellRate = midRate * (1 + bidBps / 10000)
  const spreadBps = to === 'NTZS' ? askBps : bidBps

  return NextResponse.json({
    from,
    to,
    fromChain,
    toChain,
    amount,
    midRate,
    bidBps,
    askBps,
    spreadBps,
    tzsBuyRate: +tzsBuyRate.toFixed(4),
    tzsSellRate: +tzsSellRate.toFixed(4),
    protocolFeeBps: PLATFORM_FX_FEE_BPS,
    expectedOutput: +expectedOutput.toFixed(6),
    minOutput: +minOutput.toFixed(6),
    rate: +(expectedOutput / amount).toFixed(6),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    lowLiquidity: lowLiquidity || noCoveredLp,
  })
}
