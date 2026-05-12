import { desc, eq, gte, sql } from 'drizzle-orm'
import { ethers } from 'ethers'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import {
  users,
  depositRequests,
  mintTransactions,
  kycCases,
  dailyIssuance,
  auditLogs,
  wallets,
  burnRequests,
} from '@ntzs/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { getBalance, ACTIVE_PSP_NAME } from '@/lib/psp'
import { OversightPortal, type OversightData } from './_components/OversightPortal'

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

export default async function OversightDashboard() {
  await requireAnyRole(['platform_compliance', 'super_admin'])

  const { db } = getDb()

  const [stats, pspBalanceRaw] = await Promise.all([
    db
      .select({
        totalUsers: sql<number>`count(distinct ${users.id})`.mapWith(Number),
        totalDeposits: sql<number>`count(${depositRequests.id})`.mapWith(Number),
      })
      .from(depositRequests)
      .leftJoin(users, eq(users.id, depositRequests.userId))
      .then(r => r[0]),
    getBalance().catch(() => ({ available: 0, pending: 0, currency: 'TZS' })),
  ])

  const [kycStats] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${kycCases.status} = 'pending')`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${kycCases.status} = 'rejected')`.mapWith(Number),
    })
    .from(kycCases)

  const today = new Date().toISOString().slice(0, 10)
  const [todayIssuance] = await db
    .select()
    .from(dailyIssuance)
    .where(eq(dailyIssuance.day, today))
    .limit(1)

  const recentDepositsRaw = await db
    .select({
      id: depositRequests.id,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      paymentProvider: depositRequests.paymentProvider,
      pspReference: depositRequests.pspReference,
      createdAt: depositRequests.createdAt,
      userEmail: users.email,
      txHash: mintTransactions.txHash,
    })
    .from(depositRequests)
    .leftJoin(users, eq(users.id, depositRequests.userId))
    .leftJoin(mintTransactions, eq(mintTransactions.depositRequestId, depositRequests.id))
    .orderBy(desc(depositRequests.createdAt))
    .limit(20)

  const recentAuditLogsRaw = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(15)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const statusBreakdown = await db
    .select({
      status: depositRequests.status,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number),
    })
    .from(depositRequests)
    .where(gte(depositRequests.createdAt, thirtyDaysAgo))
    .groupBy(depositRequests.status)

  const recentBurnsRaw = await db
    .select({
      id: burnRequests.id,
      amountTzs: burnRequests.amountTzs,
      status: burnRequests.status,
      txHash: burnRequests.txHash,
      recipientPhone: burnRequests.recipientPhone,
      payoutStatus: burnRequests.payoutStatus,
      payoutReference: burnRequests.payoutReference,
      platformFeeTzs: burnRequests.platformFeeTzs,
      feeTxHash: burnRequests.feeTxHash,
      createdAt: burnRequests.createdAt,
      userEmail: users.email,
    })
    .from(burnRequests)
    .leftJoin(users, eq(users.id, burnRequests.userId))
    .orderBy(desc(burnRequests.createdAt))
    .limit(20)

  const [burnStats] = await db
    .select({
      totalBurned: sql<number>`coalesce(sum(case when ${burnRequests.status} = 'burned' then ${burnRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
      burnCount: sql<number>`count(case when ${burnRequests.status} = 'burned' then 1 end)`.mapWith(Number),
      totalPlatformFees: sql<number>`coalesce(sum(${burnRequests.platformFeeTzs}), 0)`.mapWith(Number),
    })
    .from(burnRequests)

  const onChainSupply = await getOnChainTotalSupply()

  const [userCount] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(users)

  const [walletCount] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(wallets)

  const data: OversightData = {
    stats: {
      totalUsers: stats?.totalUsers ?? 0,
      totalDeposits: stats?.totalDeposits ?? 0,
    },
    pspBalance: {
      available: pspBalanceRaw.available,
      pending: pspBalanceRaw.pending,
      currency: pspBalanceRaw.currency,
      pspName: ACTIVE_PSP_NAME,
    },
    kycStats: {
      total: kycStats?.total ?? 0,
      approved: kycStats?.approved ?? 0,
      pending: kycStats?.pending ?? 0,
      rejected: kycStats?.rejected ?? 0,
    },
    todayIssuance: todayIssuance
      ? { issuedTzs: todayIssuance.issuedTzs, capTzs: todayIssuance.capTzs }
      : null,
    recentDeposits: recentDepositsRaw.map(r => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    })),
    recentAuditLogs: recentAuditLogsRaw.map(r => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    })),
    statusBreakdown,
    recentBurns: recentBurnsRaw.map(r => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    })),
    burnStats: {
      totalBurned: burnStats?.totalBurned ?? 0,
      burnCount: burnStats?.burnCount ?? 0,
      totalPlatformFees: burnStats?.totalPlatformFees ?? 0,
    },
    onChainSupply,
    userCount: userCount?.count ?? 0,
    walletCount: walletCount?.count ?? 0,
    contractAddress: CONTRACT_ADDRESS ?? '',
  }

  return <OversightPortal data={data} />
}
