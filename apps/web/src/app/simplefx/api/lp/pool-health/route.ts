import { NextResponse } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpAccounts, lpPoolPositions, lpFxPairs, lpFxConfig } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { JsonRpcProvider, Contract, formatUnits } from 'ethers'
import { getChainConfig, getChainTokens, type ChainId } from '@/lib/fx/chainConfig'

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)']

export async function GET() {
  try {
    const session = await getSessionFromCookies()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    // Build token map per chain from CHAIN_TOKENS (source of truth for which tokens exist on each chain)
    const activeChains = new Set<ChainId>(activePairs.map((p) => (p.chain ?? 'base') as ChainId))
    const tokensByChain = new Map<ChainId, Map<string, { address: string; symbol: string; decimals: number }>>()
    for (const chain of activeChains) {
      const map = new Map<string, { address: string; symbol: string; decimals: number }>()
      for (const token of Object.values(getChainTokens(chain))) {
        map.set(token.address.toLowerCase(), { address: token.address, symbol: token.symbol, decimals: token.decimals })
      }
      tokensByChain.set(chain, map)
    }

    // Fetch solver balance for every token on its chain — aggregate by uppercase symbol
    const solverBySym = new Map<string, number>()
    await Promise.all(
      [...tokensByChain.entries()].map(async ([chain, tokenMap]) => {
        let cfg: ReturnType<typeof getChainConfig>
        try { cfg = getChainConfig(chain) } catch { return }
        const provider = new JsonRpcProvider(cfg.rpcUrl)
        await Promise.all(
          [...tokenMap.values()].map(async (t) => {
            try {
              const contract = new Contract(t.address, ERC20_ABI, provider)
              const raw: bigint = await contract.balanceOf(cfg.solverAddress)
              const bal = parseFloat(formatUnits(raw, t.decimals))
              const sym = t.symbol.toUpperCase()
              solverBySym.set(sym, (solverBySym.get(sym) ?? 0) + bal)
            } catch { /* skip on RPC error */ }
          })
        )
      })
    )

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

    // Build a flat token list for share calculations
    const allTokens = [...tokensByChain.values()].flatMap((m) => [...m.values()])
    const seenAddrs = new Set<string>()
    const uniqueTokens = allTokens.filter((t) => {
      const addr = t.address.toLowerCase()
      if (seenAddrs.has(addr)) return false
      seenAddrs.add(addr)
      return true
    })

    // LP effective balances by token (share of solver balance)
    const effectiveBySym = new Map<string, number>()
    for (const t of uniqueTokens) {
      const addr = t.address.toLowerCase()
      const sym = t.symbol.toUpperCase()
      const solverBal = solverBySym.get(sym) ?? 0
      const total = totalContrib.get(addr) ?? 0
      const mine  = myContrib.get(addr) ?? 0
      const share = total > 0 ? mine / total : 0
      effectiveBySym.set(sym, (effectiveBySym.get(sym) ?? 0) + solverBal * share)
    }

    // Contributed totals by symbol (aggregate across chains)
    const totalBySym = new Map<string, number>()
    const myBySym = new Map<string, number>()
    for (const t of uniqueTokens) {
      const addr = t.address.toLowerCase()
      const sym = t.symbol.toUpperCase()
      totalBySym.set(sym, (totalBySym.get(sym) ?? 0) + (totalContrib.get(addr) ?? 0))
      myBySym.set(sym, (myBySym.get(sym) ?? 0) + (myContrib.get(addr) ?? 0))
    }

    const ntzsTotal = totalBySym.get('NTZS') ?? 0
    const usdcTotal = totalBySym.get('USDC') ?? 0
    const usdtTotal = totalBySym.get('USDT') ?? 0
    const myNtzs = myBySym.get('NTZS') ?? 0
    const myUsdc = myBySym.get('USDC') ?? 0
    const myUsdt = myBySym.get('USDT') ?? 0

    const ntzsSharePct = ntzsTotal > 0 ? myNtzs / ntzsTotal : 0
    const usdcSharePct = usdcTotal > 0 ? myUsdc / usdcTotal : 0
    const usdtSharePct = usdtTotal > 0 ? myUsdt / usdtTotal : 0

    // Skew: each token's USD value as % of total pool
    const ntzsValueUsdc = solverNtzs / midRate
    const totalValueUsdc = ntzsValueUsdc + solverUsdc + solverUsdt
    const ntzsSkewPct = totalValueUsdc > 0 ? (ntzsValueUsdc / totalValueUsdc) * 100 : 33.3
    const usdcSkewPct = totalValueUsdc > 0 ? (solverUsdc / totalValueUsdc) * 100 : 33.3
    const usdtSkewPct = 100 - ntzsSkewPct - usdcSkewPct

    const LOW_THRESHOLD = 10
    const isNtzsLow = ntzsSkewPct < LOW_THRESHOLD
    const isUsdcLow = usdcSkewPct < LOW_THRESHOLD
    const isUsdtLow = solverUsdt > 0 ? usdtSkewPct < LOW_THRESHOLD : false

    return NextResponse.json({
      solver: {
        ntzs: solverNtzs.toString(),
        usdc: solverUsdc.toString(),
        usdt: solverUsdt.toString(),
      },
      lp: {
        effectiveNtzs: (effectiveBySym.get('NTZS') ?? 0).toFixed(6),
        effectiveUsdc: (effectiveBySym.get('USDC') ?? 0).toFixed(6),
        effectiveUsdt: (effectiveBySym.get('USDT') ?? 0).toFixed(6),
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
