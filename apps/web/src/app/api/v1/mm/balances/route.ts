import { NextRequest, NextResponse } from 'next/server'
import { authenticateMM } from '@/lib/fx/auth'
import { getDb } from '@/lib/db'
import { lpAccounts, lpPoolPositions } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { JsonRpcProvider, Contract, formatUnits } from 'ethers'

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]
const NTZS = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

async function getOnChainBalance(provider: JsonRpcProvider, token: string, wallet: string) {
  const contract = new Contract(token, ERC20_ABI, provider)
  const [raw, decimals]: [bigint, bigint] = await Promise.all([
    contract.balanceOf(wallet),
    contract.decimals(),
  ])
  return formatUnits(raw, Number(decimals))
}

export async function GET(request: NextRequest) {
  const authResult = await authenticateMM(request)
  if ('error' in authResult) return authResult.error

  const { mm } = authResult
  const { db } = getDb()

  try {
    const [lp] = await db
      .select({ walletAddress: lpAccounts.walletAddress, isActive: lpAccounts.isActive })
      .from(lpAccounts)
      .where(eq(lpAccounts.id, mm.lpId))
      .limit(1)

    if (!lp) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const rpcUrl = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'
    const provider = new JsonRpcProvider(rpcUrl)

    if (lp.isActive) {
      const positions = await db
        .select()
        .from(lpPoolPositions)
        .where(eq(lpPoolPositions.lpId, mm.lpId))

      const byToken: Record<string, { contributed: string; earned: string; total: string }> = {}
      for (const pos of positions) {
        const sym = pos.tokenSymbol.toLowerCase()
        byToken[sym] = {
          contributed: pos.contributed,
          earned: pos.earned,
          total: (parseFloat(pos.contributed) + parseFloat(pos.earned)).toString(),
        }
      }

      const [walletNtzs, walletUsdc] = await Promise.all([
        getOnChainBalance(provider, NTZS, lp.walletAddress),
        getOnChainBalance(provider, USDC, lp.walletAddress),
      ])

      return NextResponse.json({
        source: 'pool',
        ntzs: byToken['ntzs']?.total ?? '0',
        usdc: byToken['usdc']?.total ?? '0',
        positions: byToken,
        wallet: { address: lp.walletAddress, chain: 'base', ntzs: walletNtzs, usdc: walletUsdc },
      })
    } else {
      const [ntzs, usdc] = await Promise.all([
        getOnChainBalance(provider, NTZS, lp.walletAddress),
        getOnChainBalance(provider, USDC, lp.walletAddress),
      ])

      return NextResponse.json({
        source: 'wallet',
        ntzs,
        usdc,
        wallet: { address: lp.walletAddress, chain: 'base' },
      })
    }
  } catch (err) {
    console.error('[mm/balances]', err)
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 })
  }
}
