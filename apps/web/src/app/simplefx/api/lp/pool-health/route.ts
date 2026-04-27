import { NextResponse } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpAccounts, lpPoolPositions, lpFxPairs, lpFxConfig } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { JsonRpcProvider, Contract, formatUnits } from 'ethers'

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)']

export async function GET() {
  try {
    const session = await getSessionFromCookies()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rpcUrl = process.env.BASE_RPC_URL
    if (!rpcUrl) return NextResponse.json({ error: 'RPC not configured' }, { status: 503 })

    const SOLVER_ADDRESS = process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646'

    const [lpRow, allPositions, fxConfig, activePairs] = await Promise.all([
      db.select({ walletAddress: lpAccounts.walletAddress, isActive: lpAccounts.isActive })
        .from(lpAccounts)
        .where(eq(lpAccounts.id, session.lpId))
        .limit(1),
      db.select({
        lpId:         lpPoolPositions.lpId,
        tokenAddress: lpPoolPositions.tokenAddress,
        tokenSymbol:  lpPoolPositions.tokenSymbol,
        contributed:  lpPoolPositions.contributed,
      }).from(lpPoolPositions),
      db.select({ midRateTZS: lpFxConfig.midRateTZS }).from(lpFxConfig).where(eq(lpFxConfig.id, 1)).limit(1),
      db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)),
    ])

    const lp = lpRow[0]
    if (!lp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const midRate = Number(fxConfig[0]?.midRateTZS ?? 3750)

    // Build unique token set from active pairs
    const tokenMap = new Map<string, { address: string; symbol: string; decimals: number }>()
    for (const p of activePairs) {
      tokenMap.set(p.token1Address.toLowerCase(), { address: p.token1Address, symbol: p.token1Symbol, decimals: p.token1Decimals })
      tokenMap.set(p.token2Address.toLowerCase(), { address: p.token2Address, symbol: p.token2Symbol, decimals: p.token2Decimals })
    }
    const tokens = [...tokenMap.values()]

    // Fetch solver wallet balance for all tokens in parallel
    const provider = new JsonRpcProvider(rpcUrl)
    const solverBalances = await Promise.all(
      tokens.map(async (t) => {
        const contract = new Contract(t.address, ERC20_ABI, provider)
        const raw: bigint = await contract.balanceOf(SOLVER_ADDRESS)
        return { ...t, balance: parseFloat(formatUnits(raw, t.decimals)) }
      })
    )

    // Index solver balances by lowercased symbol
    const solverBySym = new Map<string, number>()
    for (const b of solverBalances) {
      solverBySym.set(b.symbol.toUpperCase(), b.balance)
    }

    const solverNtzs = solverBySym.get('NTZS') ?? 0
    const solverUsdc = solverBySym.get('USDC') ?? 0
    const solverUsdt = solverBySym.get('USDT') ?? 0

    // Pool-wide contributed totals per token address
    const totalContrib = new Map<string, number>()
    const myContrib = new Map<string, number>()
    for (const pos of allPositions) {
      const addr = pos.tokenAddress.toLowerCase()
      const c = parseFloat(pos.contributed)
      totalContrib.set(addr, (totalContrib.get(addr) ?? 0) + c)
      if (pos.lpId === session.lpId) {
        myContrib.set(addr, (myContrib.get(addr) ?? 0) + c)
      }
    }

    // LP effective balances by token (share of solver balance)
    const effectiveByAddr = new Map<string, number>()
    for (const b of solverBalances) {
      const addr = b.address.toLowerCase()
      const total = totalContrib.get(addr) ?? 0
      const mine  = myContrib.get(addr) ?? 0
      const share = total > 0 ? mine / total : 0
      effectiveByAddr.set(addr, b.balance * share)
    }

    const ntzsAddr = tokens.find((t) => t.symbol.toUpperCase() === 'NTZS')?.address.toLowerCase() ?? ''
    const usdcAddr = tokens.find((t) => t.symbol.toUpperCase() === 'USDC')?.address.toLowerCase() ?? ''
    const usdtAddr = tokens.find((t) => t.symbol.toUpperCase() === 'USDT')?.address.toLowerCase() ?? ''

    const effectiveNtzs = effectiveByAddr.get(ntzsAddr) ?? 0
    const effectiveUsdc = effectiveByAddr.get(usdcAddr) ?? 0
    const effectiveUsdt = effectiveByAddr.get(usdtAddr) ?? 0

    const ntzsTotal = totalContrib.get(ntzsAddr) ?? 0
    const usdcTotal = totalContrib.get(usdcAddr) ?? 0
    const usdtTotal = totalContrib.get(usdtAddr) ?? 0
    const myNtzs = myContrib.get(ntzsAddr) ?? 0
    const myUsdc = myContrib.get(usdcAddr) ?? 0
    const myUsdt = myContrib.get(usdtAddr) ?? 0

    const ntzsSharePct = ntzsTotal > 0 ? myNtzs / ntzsTotal : 0
    const usdcSharePct = usdcTotal > 0 ? myUsdc / usdcTotal : 0
    const usdtSharePct = usdtTotal > 0 ? myUsdt / usdtTotal : 0

    // Pool skew: each token's value in USD terms as % of total pool value
    const ntzsValueUsdc = solverNtzs / midRate
    const totalValueUsdc = ntzsValueUsdc + solverUsdc + solverUsdt
    const ntzsSkewPct = totalValueUsdc > 0 ? (ntzsValueUsdc / totalValueUsdc) * 100 : 33.3
    const usdcSkewPct = totalValueUsdc > 0 ? (solverUsdc / totalValueUsdc) * 100 : 33.3
    const usdtSkewPct = 100 - ntzsSkewPct - usdcSkewPct

    const LOW_THRESHOLD = 10
    const isNtzsLow = ntzsSkewPct < LOW_THRESHOLD
    const isUsdcLow = usdcSkewPct < LOW_THRESHOLD
    const isUsdtLow = usdtAddr ? usdtSkewPct < LOW_THRESHOLD : false

    return NextResponse.json({
      solver: {
        ntzs: solverNtzs.toString(),
        usdc: solverUsdc.toString(),
        usdt: solverUsdt.toString(),
      },
      lp: {
        effectiveNtzs: effectiveNtzs.toFixed(6),
        effectiveUsdc: effectiveUsdc.toFixed(6),
        effectiveUsdt: effectiveUsdt.toFixed(6),
        ntzsSharePct: (ntzsSharePct * 100).toFixed(1),
        usdcSharePct: (usdcSharePct * 100).toFixed(1),
        usdtSharePct: (usdtSharePct * 100).toFixed(1),
      },
      skew: {
        ntzsSkewPct: ntzsSkewPct.toFixed(1),
        usdcSkewPct: usdcSkewPct.toFixed(1),
        usdtSkewPct: usdtSkewPct.toFixed(1),
        isNtzsLow,
        isUsdcLow,
        isUsdtLow,
        midRate,
      },
      isActive: lp.isActive,
    })
  } catch (err) {
    console.error('[pool-health]', err)
    return NextResponse.json({ error: 'Failed to fetch pool health' }, { status: 500 })
  }
}
