import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { getDb } from '@/lib/db'
import { lpFxPairs, lpAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { calcMinOutput, SWAP_TOKENS, type SwapTokenSymbol } from '@/lib/fx/swap'

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

  const NTZS = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'.toLowerCase()
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase()

  const tokenAddressFor = (sym: SwapTokenSymbol) => (sym === 'NTZS' ? NTZS : USDC)

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

  // Pick best LP spread for this direction
  const activeLPs = await db
    .select({ bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true as unknown as boolean))

  const direction = from === 'USDC' ? 'ask' : 'bid'
  const sorted = [...activeLPs].sort((a, b) =>
    direction === 'ask'
      ? (a.askBps ?? 150) - (b.askBps ?? 150)
      : (a.bidBps ?? 120) - (b.bidBps ?? 120)
  )
  const bestLP = sorted[0]

  const bidBps = bestLP?.bidBps ?? 120
  const askBps = bestLP?.askBps ?? 150

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

  // Check solver pool liquidity for the output token
  let lowLiquidity = false
  const solverAddress = process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646'
  const rpcUrl = process.env.BASE_RPC_URL
  if (rpcUrl) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const outToken = SWAP_TOKENS[to]
      const contract = new ethers.Contract(outToken.address, ['function balanceOf(address) view returns (uint256)'], provider)
      const balance = await contract.balanceOf(solverAddress)
      const balanceFormatted = parseFloat(ethers.formatUnits(balance, outToken.decimals))
      lowLiquidity = balanceFormatted < expectedOutput * 1.1
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
