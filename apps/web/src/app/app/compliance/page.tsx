import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { ethers } from 'ethers'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import {
  auditLogs,
  burnRequests,
  dailyIssuance,
  depositRequests,
  kycCases,
  reconciliationEntries,
  users,
} from '@ntzs/db'
import {
  SANDBOX_DAILY_USER_CAP_TZS,
  SANDBOX_MONTHLY_USER_CAP_TZS,
  SANDBOX_PER_TXN_CAP_TZS,
} from '@/lib/sandbox/limits'
import { CompliancePortal } from './_components/CompliancePortal'
import type { ComplianceData } from './_components/CompliancePortal'

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = NTZS_CONTRACT_ADDRESS_BASE ?? ''
const SAFE_ADDRESS = '0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503'
const BOT_APPROVAL_REF = 'LD. 170/515/02/1254'
const SANDBOX_DEADLINE = new Date('2026-06-23T00:00:00.000Z')
const PLATFORM_DAILY_CAP_TZS = Number(process.env.DAILY_ISSUANCE_CAP_TZS ?? '100000000')

// PSP statuses representing fiat confirmed by Snippe webhook or beyond
const PSP_CONFIRMED_STATUSES = [
  'fiat_confirmed',
  'bank_approved',
  'platform_approved',
  'mint_pending',
  'mint_requires_safe',
  'mint_processing',
  'minted',
] as const

async function getOnChainTotalSupply(): Promise<number> {
  if (!CONTRACT_ADDRESS) return 0
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const contract = new ethers.Contract(
      CONTRACT_ADDRESS,
      ['function totalSupply() view returns (uint256)'],
      provider
    )
    const supply = await contract.totalSupply()
    return Number(ethers.formatUnits(supply, 18))
  } catch {
    return 0
  }
}

export default async function CompliancePage() {
  await requireAnyRole(['platform_compliance', 'super_admin', 'bot_regulator'])

  const { db } = getDb()
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const daysToDeadline = Math.max(0, Math.ceil((SANDBOX_DEADLINE.getTime() - now.getTime()) / 86_400_000))
  const sandboxPhase = daysToDeadline > 0 ? 'Pre-commencement' : 'Active Testing'

  const [
    onChainSupply,
    pspConfirmedTotal,
    pspMintedTotal,
    reconAdjustments,
    kycStats,
    endUserCount,
    todayIssuance,
    last24hDeposits,
    last24hBurns,
    recentEnforcement,
    liquidityData,
  ] = await Promise.all([
    // 1. On-chain supply — authoritative circulation figure
    getOnChainTotalSupply(),

    // 2. Total PSP-confirmed fiat from Snippe (webhook-confirmed and beyond, Base mainnet)
    db.select({
      total: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number),
    }).from(depositRequests).where(
      and(
        inArray(depositRequests.paymentProvider, ['snippe', 'snippe_card']),
        inArray(depositRequests.status, PSP_CONFIRMED_STATUSES),
        eq(depositRequests.chain, 'base'),
      )
    ).then(r => r[0]?.total ?? 0),

    // 3. Subset of above that are already minted on-chain
    db.select({
      total: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number),
    }).from(depositRequests).where(
      and(
        inArray(depositRequests.paymentProvider, ['snippe', 'snippe_card']),
        eq(depositRequests.status, 'minted'),
        eq(depositRequests.chain, 'base'),
      )
    ).then(r => r[0]?.total ?? 0),

    // 4. Manual reconciliation adjustments (opening balance, corrections)
    db.select({
      total: sql<number>`coalesce(sum(${reconciliationEntries.amountTzs}), 0)`.mapWith(Number),
    }).from(reconciliationEntries).where(
      eq(reconciliationEntries.chain, 'base')
    ).then(r => r[0]?.total ?? 0),

    // 5. KYC stats
    db.select({
      approved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${kycCases.status} = 'pending')`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${kycCases.status} = 'rejected')`.mapWith(Number),
    }).from(kycCases).then(r => r[0]),

    // 6. End user count
    db.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(users).where(eq(users.role, 'end_user'))
      .then(r => r[0]?.count ?? 0),

    // 7. Today's platform issuance
    db.select().from(dailyIssuance).where(eq(dailyIssuance.day, todayStr)).limit(1)
      .then(r => r[0]),

    // 8. Last 24h deposit summary
    db.select({
      count: sql<number>`count(*)`.mapWith(Number),
      totalTzs: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${depositRequests.status} = 'rejected')`.mapWith(Number),
    }).from(depositRequests).where(gte(depositRequests.createdAt, last24h))
      .then(r => r[0]),

    // 9. Last 24h burns (completed)
    db.select({
      count: sql<number>`count(*)`.mapWith(Number),
      totalTzs: sql<number>`coalesce(sum(${burnRequests.amountTzs}), 0)`.mapWith(Number),
    }).from(burnRequests).where(
      and(gte(burnRequests.createdAt, last24h), eq(burnRequests.status, 'burned'))
    ).then(r => r[0]),

    // 10. Recent enforcement actions
    db.select({
      action: auditLogs.action,
      createdAt: auditLogs.createdAt,
      actorEmail: users.email,
    }).from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(inArray(auditLogs.action, ['freeze_wallet', 'blacklist_wallet', 'unfreeze_wallet', 'pause_contract', 'wipe_wallet']))
      .orderBy(desc(auditLogs.createdAt))
      .limit(5),

    // 11. 30-day burn totals for liquidity buffer calculation
    db.select({
      totalBurned30d: sql<number>`coalesce(sum(${burnRequests.amountTzs}), 0)`.mapWith(Number),
      burnDays: sql<number>`count(distinct date_trunc('day', ${burnRequests.createdAt}))`.mapWith(Number),
    }).from(burnRequests).where(
      and(
        eq(burnRequests.status, 'burned'),
        gte(burnRequests.createdAt, thirtyDaysAgo),
        eq(burnRequests.chain, 'base'),
      )
    ).then(r => r[0]),
  ])

  const avg30dDailyRedemptions = liquidityData && liquidityData.burnDays > 0
    ? liquidityData.totalBurned30d / liquidityData.burnDays
    : null

  const generatedAt = now.toLocaleString('en-TZ', {
    timeZone: 'Africa/Dar_es_Salaam',
    dateStyle: 'long',
    timeStyle: 'medium',
  })

  const data: ComplianceData = {
    daysToDeadline,
    sandboxPhase,
    generatedAt,
    botApprovalRef: BOT_APPROVAL_REF,
    onChainSupply,
    pspConfirmedTotal,
    pspMintedTotal,
    reconAdjustments,
    issuedToday: todayIssuance?.issuedTzs ?? 0,
    platformDailyCap: PLATFORM_DAILY_CAP_TZS,
    perTxnCap: SANDBOX_PER_TXN_CAP_TZS,
    dailyUserCap: SANDBOX_DAILY_USER_CAP_TZS,
    monthlyUserCap: SANDBOX_MONTHLY_USER_CAP_TZS,
    kycApproved: kycStats?.approved ?? 0,
    kycPending: kycStats?.pending ?? 0,
    kycRejected: kycStats?.rejected ?? 0,
    endUserCount,
    deposits24hCount: last24hDeposits?.count ?? 0,
    deposits24hTzs: last24hDeposits?.totalTzs ?? 0,
    deposits24hRejected: last24hDeposits?.rejected ?? 0,
    burns24hCount: last24hBurns?.count ?? 0,
    burns24hTzs: last24hBurns?.totalTzs ?? 0,
    contractAddress: CONTRACT_ADDRESS,
    safeAddress: SAFE_ADDRESS,
    recentEnforcement: recentEnforcement.map(e => ({
      action: e.action,
      actorEmail: e.actorEmail ?? null,
      createdAt: e.createdAt ? e.createdAt.toISOString() : null,
    })),
    avg30dDailyRedemptions,
  }

  return <CompliancePortal data={data} />
}
