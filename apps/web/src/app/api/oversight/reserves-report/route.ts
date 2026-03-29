import { NextResponse } from 'next/server'
import { desc, eq, sql } from 'drizzle-orm'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import {
  users,
  depositRequests,
  mintTransactions,
  kycCases,
  dailyIssuance,
  wallets,
} from '@ntzs/db'

const CONTRACT_ADDRESS = NTZS_CONTRACT_ADDRESS_BASE
const RPC_URL = BASE_RPC_URL

async function getOnChainTotalSupply(): Promise<string> {
  if (!CONTRACT_ADDRESS) return '0'
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const contract = new ethers.Contract(
      CONTRACT_ADDRESS,
      ['function totalSupply() view returns (uint256)'],
      provider
    )
    const supply = await contract.totalSupply()
    return ethers.formatUnits(supply, 18)
  } catch {
    return '0'
  }
}

export async function GET() {
  const { db } = getDb()

  // Get aggregate stats
  const [stats] = await db
    .select({
      totalUsers: sql<number>`count(distinct ${users.id})`.mapWith(Number),
      totalDeposits: sql<number>`count(${depositRequests.id})`.mapWith(Number),
      totalMinted: sql<number>`coalesce(sum(case when ${depositRequests.status} = 'minted' then ${depositRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
      totalPending: sql<number>`coalesce(sum(case when ${depositRequests.status} in ('submitted', 'mint_pending', 'mint_processing') then ${depositRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
    })
    .from(depositRequests)
    .leftJoin(users, eq(users.id, depositRequests.userId))

  // KYC stats
  const [kycStats] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${kycCases.status} = 'pending')`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${kycCases.status} = 'rejected')`.mapWith(Number),
    })
    .from(kycCases)

  // Today's issuance
  const today = new Date().toISOString().slice(0, 10)
  const [todayIssuance] = await db
    .select()
    .from(dailyIssuance)
    .where(eq(dailyIssuance.day, today))
    .limit(1)

  // Recent deposits
  const recentDeposits = await db
    .select({
      id: depositRequests.id,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      paymentProvider: depositRequests.paymentProvider,
      pspReference: depositRequests.pspReference,
      createdAt: depositRequests.createdAt,
      txHash: mintTransactions.txHash,
    })
    .from(depositRequests)
    .leftJoin(mintTransactions, eq(mintTransactions.depositRequestId, depositRequests.id))
    .orderBy(desc(depositRequests.createdAt))
    .limit(20)

  // Deposit status breakdown
  const statusBreakdown = await db
    .select({
      status: depositRequests.status,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number),
    })
    .from(depositRequests)
    .groupBy(depositRequests.status)

  // On-chain total supply
  const onChainSupply = await getOnChainTotalSupply()

  // User count
  const [userCount] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(users)

  // Wallet count
  const [walletCount] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(wallets)

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    contractAddress: CONTRACT_ADDRESS,
    network: 'Base Mainnet',
    onChainSupply: parseFloat(onChainSupply),
    stats: {
      totalUsers: userCount?.count || 0,
      totalWallets: walletCount?.count || 0,
      totalDeposits: stats?.totalDeposits || 0,
      totalMinted: stats?.totalMinted || 0,
      totalPending: stats?.totalPending || 0,
    },
    kyc: {
      approved: kycStats?.approved || 0,
      pending: kycStats?.pending || 0,
      rejected: kycStats?.rejected || 0,
    },
    dailyIssuance: {
      date: today,
      cap: todayIssuance?.capTzs || 100000000,
      issued: todayIssuance?.issuedTzs || 0,
      reserved: todayIssuance?.reservedTzs || 0,
    },
    statusBreakdown: statusBreakdown.map((s) => ({
      status: s.status,
      count: s.count,
      totalTzs: s.total,
    })),
    recentDeposits: recentDeposits.map((d) => ({
      id: d.id,
      amountTzs: d.amountTzs,
      status: d.status,
      provider: d.paymentProvider,
      reference: d.pspReference,
      txHash: d.txHash,
      createdAt: d.createdAt,
    })),
  })
}
