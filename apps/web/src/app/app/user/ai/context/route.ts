import { NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import { getCachedRecentBurns, getCachedRecentDeposits, getCachedRecentSends, getCachedRecentSwaps } from '@/lib/user/cachedQueries'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'

export const runtime = 'nodejs'

type DatedRow = {
  createdAt: Date | null
  amountTzs?: number
}

const TOKEN_ABI = ['function balanceOf(address owner) view returns (uint256)'] as const
const DAY_MS = 24 * 60 * 60 * 1000
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000

function startOfTodayUtcForEAT(now = new Date()) {
  const eatMs = now.getTime() + EAT_OFFSET_MS
  const eatStartMs = Math.floor(eatMs / DAY_MS) * DAY_MS
  return new Date(eatStartMs - EAT_OFFSET_MS)
}

function sumAmount(rows: DatedRow[]) {
  return rows.reduce((sum, row) => sum + (row.amountTzs ?? 0), 0)
}

export async function GET() {
  let dbUser: Awaited<ReturnType<typeof requireAnyRole>>
  try {
    dbUser = await requireAnyRole(['end_user', 'super_admin'])
  } catch {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const userId = dbUser.id
  const todayStartUtc = startOfTodayUtcForEAT()

  const [wallet, deposits, burns, sends, swaps] = await Promise.all([
    getCachedWallet(userId),
    getCachedRecentDeposits(userId, 250),
    getCachedRecentBurns(userId, 250),
    getCachedRecentSends(userId, 250),
    getCachedRecentSwaps(userId, 250),
  ])

  const mintedDeposits = deposits.filter((d) => d.status === 'minted')
  const burnedWithdrawals = burns.filter((b) => b.status === 'burned')

  const isToday = (date: Date | null) => !!date && date >= todayStartUtc

  const depositedToday = mintedDeposits.filter((d) => isToday(d.createdAt))
  const spentTodayRows: DatedRow[] = [
    ...burnedWithdrawals.filter((b) => isToday(b.createdAt)).map((b) => ({ createdAt: b.createdAt, amountTzs: b.amountTzs })),
    ...sends.filter((s) => isToday(s.createdAt)).map((s) => ({ createdAt: s.createdAt, amountTzs: s.amountTzs })),
  ]

  const depositedAll = mintedDeposits.map((d) => ({ createdAt: d.createdAt, amountTzs: d.amountTzs }))
  const spentAllRows: DatedRow[] = [
    ...burnedWithdrawals.map((b) => ({ createdAt: b.createdAt, amountTzs: b.amountTzs })),
    ...sends.map((s) => ({ createdAt: s.createdAt, amountTzs: s.amountTzs })),
  ]

  const depositedTodayTzs = sumAmount(depositedToday)
  const spentTodayTzs = sumAmount(spentTodayRows)
  const depositedAllTimeTzs = sumAmount(depositedAll)
  const spentAllTimeTzs = sumAmount(spentAllRows)

  const swapVolumeTodayTzsApprox = swaps
    .filter((s) => isToday(s.createdAt))
    .reduce((sum, s) => sum + (Number.parseFloat(s.amountIn) || 0), 0)

  const swapVolumeAllTimeTzsApprox = swaps
    .reduce((sum, s) => sum + (Number.parseFloat(s.amountIn) || 0), 0)

  const activityCountToday = depositedToday.length + spentTodayRows.length + swaps.filter((s) => isToday(s.createdAt)).length
  const activityCountAllTime = depositedAll.length + spentAllRows.length + swaps.length

  let walletBalanceTzs = depositedAllTimeTzs - spentAllTimeTzs
  let walletBalanceSource: 'onchain' | 'estimated' = 'estimated'

  if (wallet?.address && BASE_RPC_URL && NTZS_CONTRACT_ADDRESS_BASE) {
    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
      const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, TOKEN_ABI, provider)
      const raw: bigint = await token.balanceOf(wallet.address)
      walletBalanceTzs = Number(ethers.formatUnits(raw, 18))
      walletBalanceSource = 'onchain'
    } catch {
      walletBalanceSource = 'estimated'
    }
  }

  return NextResponse.json({
    walletBalanceTzs,
    walletBalanceSource,
    spentTodayTzs,
    spentAllTimeTzs,
    depositedTodayTzs,
    depositedAllTimeTzs,
    swapVolumeTodayTzsApprox,
    swapVolumeAllTimeTzsApprox,
    activityCountToday,
    activityCountAllTime,
    todayStartUtc: todayStartUtc.toISOString(),
    updatedAt: new Date().toISOString(),
  })
}
