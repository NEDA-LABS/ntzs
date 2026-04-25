import { NextResponse } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpAccounts, lpPoolPositions, lpFxConfig } from '@ntzs/db'
import { eq, sql } from 'drizzle-orm'
import { JsonRpcProvider, Contract, formatUnits } from 'ethers'

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)']
const NTZS          = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
const USDC          = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const SOLVER_ADDRESS = process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646'

export async function GET() {
  try {
    const session = await getSessionFromCookies()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rpcUrl = process.env.BASE_RPC_URL
    if (!rpcUrl) return NextResponse.json({ error: 'RPC not configured' }, { status: 503 })

    const [lpRow, allPositions, fxConfig] = await Promise.all([
      db.select({ walletAddress: lpAccounts.walletAddress, isActive: lpAccounts.isActive })
        .from(lpAccounts)
        .where(eq(lpAccounts.id, session.lpId))
        .limit(1),
      // All active LP positions across all LPs for pool-wide totals
      db.select({
        lpId:         lpPoolPositions.lpId,
        tokenAddress: lpPoolPositions.tokenAddress,
        tokenSymbol:  lpPoolPositions.tokenSymbol,
        contributed:  lpPoolPositions.contributed,
        earned:       lpPoolPositions.earned,
      }).from(lpPoolPositions),
      db.select({ midRateTZS: lpFxConfig.midRateTZS }).from(lpFxConfig).where(eq(lpFxConfig.id, 1)).limit(1),
    ])

    const lp = lpRow[0]
    if (!lp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const midRate = Number(fxConfig[0]?.midRateTZS ?? 3750) // nTZS per USDC

    // On-chain solver wallet balances (source of truth)
    const provider = new JsonRpcProvider(rpcUrl)
    const ntzsContract = new Contract(NTZS, ERC20_ABI, provider)
    const usdcContract = new Contract(USDC, ERC20_ABI, provider)
    const [solverNtzsRaw, solverUsdcRaw]: [bigint, bigint] = await Promise.all([
      ntzsContract.balanceOf(SOLVER_ADDRESS),
      usdcContract.balanceOf(SOLVER_ADDRESS),
    ])
    const solverNtzs = parseFloat(formatUnits(solverNtzsRaw, 18))
    const solverUsdc = parseFloat(formatUnits(solverUsdcRaw, 6))

    // Pool-wide contributed totals per token
    let totalNtzs = 0, totalUsdc = 0
    let myNtzs = 0, myUsdc = 0
    for (const pos of allPositions) {
      const c = parseFloat(pos.contributed)
      const sym = pos.tokenSymbol.toUpperCase()
      if (sym === 'NTZS') {
        totalNtzs += c
        if (pos.lpId === session.lpId) myNtzs = c
      } else if (sym === 'USDC') {
        totalUsdc += c
        if (pos.lpId === session.lpId) myUsdc = c
      }
    }

    // LP share as fraction of each token's pool
    const ntzsSharePct = totalNtzs > 0 ? myNtzs / totalNtzs : 0
    const usdcSharePct = totalUsdc > 0 ? myUsdc / totalUsdc : 0

    // LP's effective current balance = share × actual solver balance
    const effectiveNtzs = solverNtzs * ntzsSharePct
    const effectiveUsdc = solverUsdc * usdcSharePct

    // Pool skew: what % of total pool value (in USDC terms) is nTZS vs USDC
    const ntzsValueUsdc = solverNtzs / midRate
    const totalValueUsdc = ntzsValueUsdc + solverUsdc
    const ntzsSkewPct = totalValueUsdc > 0 ? (ntzsValueUsdc / totalValueUsdc) * 100 : 50
    const usdcSkewPct = 100 - ntzsSkewPct

    // Alert if either side drops below 10% of total pool value
    const LOW_THRESHOLD = 10
    const isNtzsLow = ntzsSkewPct < LOW_THRESHOLD
    const isUsdcLow = usdcSkewPct < LOW_THRESHOLD

    return NextResponse.json({
      solver: {
        ntzs: solverNtzs.toString(),
        usdc: solverUsdc.toString(),
      },
      lp: {
        effectiveNtzs: effectiveNtzs.toFixed(6),
        effectiveUsdc: effectiveUsdc.toFixed(6),
        ntzsSharePct:  (ntzsSharePct * 100).toFixed(1),
        usdcSharePct:  (usdcSharePct * 100).toFixed(1),
      },
      skew: {
        ntzsSkewPct: ntzsSkewPct.toFixed(1),
        usdcSkewPct: usdcSkewPct.toFixed(1),
        isNtzsLow,
        isUsdcLow,
        midRate,
      },
      isActive: lp.isActive,
    })
  } catch (err) {
    console.error('[pool-health]', err)
    return NextResponse.json({ error: 'Failed to fetch pool health' }, { status: 500 })
  }
}
