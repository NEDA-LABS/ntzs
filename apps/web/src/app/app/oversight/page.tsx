import { desc, eq, gte, inArray, sql } from 'drizzle-orm'
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
  attestations,
  partnerUsers,
  partners,
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
  await requireAnyRole(['platform_compliance', 'super_admin', 'bot_regulator'])

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
      // Distinct PERSONS with an approved case — the number that counts
      // toward the 100-participant pilot cap (Parameter 2).
      verifiedIdentities: sql<number>`count(distinct ${kycCases.userId}) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
      // Tier split: instant provider verification vs human maker-checker
      // review (reviewed_by_user_id is set only by a human decision).
      instantApproved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved' and ${kycCases.reviewedByUserId} is null)`.mapWith(Number),
      humanReviewed: sql<number>`count(*) filter (where ${kycCases.status} = 'approved' and ${kycCases.reviewedByUserId} is not null)`.mapWith(Number),
    })
    .from(kycCases)

  const kycByProvider = await db
    .select({
      provider: kycCases.provider,
      count: sql<number>`count(*)`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
    })
    .from(kycCases)
    .groupBy(kycCases.provider)

  // Verification split by issuance channel: which surface issued the wallet —
  // the direct app or a WaaS partner (NEDApay, …). Regulator-legible view of
  // where participants come from.
  const kycBySource = await db
    .select({
      source: sql<string>`coalesce(${partners.name}, 'Direct app')`,
      total: sql<number>`count(*)`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${kycCases.status} = 'pending')`.mapWith(Number),
    })
    .from(kycCases)
    .leftJoin(partnerUsers, eq(partnerUsers.userId, kycCases.userId))
    .leftJoin(partners, eq(partners.id, partnerUsers.partnerId))
    .groupBy(sql`coalesce(${partners.name}, 'Direct app')`)

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
    // Exclude internal UI telemetry (assistant clicks etc.) — not a regulatory event.
    .where(sql`${auditLogs.entityType} is distinct from 'ui'`)
    .orderBy(desc(auditLogs.createdAt))
    .limit(60)

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

  // Explicit columns: a select-all here would break the moment schema.ts gains
  // a column ahead of its manual migration (annex/0062 pattern).
  const attestationRows = await db
    .select({
      reportDate: attestations.reportDate,
      ntzsCirculation: attestations.ntzsCirculation,
      tzsCustodialReserve: attestations.tzsCustodialReserve,
      tzsGovtSecurities: attestations.tzsGovtSecurities,
      reserveTotal: attestations.reserveTotal,
      deviationPct: attestations.deviationPct,
      fullyBacked: attestations.fullyBacked,
      reportHash: attestations.reportHash,
      createdAt: attestations.createdAt,
    })
    .from(attestations)
    .orderBy(desc(attestations.reportDate))
    .limit(30)

  // ── TZS provenance trail for issuance/redemption audit events ──────────────
  // Joins each mint event to its deposit (cash-before-mint proof: fiat_confirmed
  // → minted timestamps) and each burn event to its redemption (dual approval →
  // payout). This is the §7(d) "no fake e-money" evidence the regulator wants.
  const auditDepIds = [...new Set(recentAuditLogsRaw.filter(l => l.entityType === 'deposit_request' && l.entityId).map(l => l.entityId as string))]
  const auditBurnIds = [...new Set(recentAuditLogsRaw.filter(l => l.entityType === 'burn_request' && l.entityId).map(l => l.entityId as string))]

  const depProvRows = auditDepIds.length
    ? await db.select({
        id: depositRequests.id, amountTzs: depositRequests.amountTzs, provider: depositRequests.paymentProvider,
        channel: depositRequests.pspChannel, reference: depositRequests.pspReference, payerName: depositRequests.payerName,
        buyerPhone: depositRequests.buyerPhone, submittedAt: depositRequests.createdAt,
        fiatConfirmedAt: depositRequests.fiatConfirmedAt, mintedAt: depositRequests.mintedAt,
      }).from(depositRequests).where(inArray(depositRequests.id, auditDepIds))
    : []
  const burnProvRows = auditBurnIds.length
    ? await db.select({
        id: burnRequests.id, amountTzs: burnRequests.amountTzs, recipientPhone: burnRequests.recipientPhone,
        reference: burnRequests.payoutReference, payoutStatus: burnRequests.payoutStatus,
        burnAt: burnRequests.createdAt, approvedAt: burnRequests.approvedAt, secondApprovedAt: burnRequests.secondApprovedAt,
      }).from(burnRequests).where(inArray(burnRequests.id, auditBurnIds))
    : []
  const depProvMap = new Map(depProvRows.map(r => [r.id, r]))
  const burnProvMap = new Map(burnProvRows.map(r => [r.id, r]))
  const isoStr = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null))
  const maskPhone = (p?: string | null) => { if (!p) return null; const s = p.replace(/\s/g, ''); return s.length > 7 ? `${s.slice(0, 6)}****${s.slice(-2)}` : s }

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
      verifiedIdentities: kycStats?.verifiedIdentities ?? 0,
      instantApproved: kycStats?.instantApproved ?? 0,
      humanReviewed: kycStats?.humanReviewed ?? 0,
    },
    kycByProvider: kycByProvider.map(p => ({
      provider: p.provider ?? 'manual',
      count: p.count,
      approved: p.approved,
    })),
    kycBySource: kycBySource.map(s => ({
      source: s.source,
      total: s.total,
      approved: s.approved,
      pending: s.pending,
    })),
    todayIssuance: todayIssuance
      ? { issuedTzs: todayIssuance.issuedTzs, capTzs: todayIssuance.capTzs }
      : null,
    recentDeposits: recentDepositsRaw.map(r => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    })),
    recentAuditLogs: recentAuditLogsRaw.map(r => {
      let provenance: OversightData['recentAuditLogs'][number]['provenance']
      const dep = r.entityType === 'deposit_request' && r.entityId ? depProvMap.get(r.entityId) : undefined
      const burn = r.entityType === 'burn_request' && r.entityId ? burnProvMap.get(r.entityId) : undefined
      if (dep) {
        provenance = {
          kind: 'issuance', amountTzs: dep.amountTzs,
          provider: dep.provider, channel: dep.channel, reference: dep.reference,
          counterparty: dep.payerName ?? maskPhone(dep.buyerPhone),
          submittedAt: isoStr(dep.submittedAt), confirmedAt: isoStr(dep.fiatConfirmedAt), completedAt: isoStr(dep.mintedAt),
        }
      } else if (burn) {
        provenance = {
          kind: 'redemption', amountTzs: burn.amountTzs,
          reference: burn.reference, payoutStatus: burn.payoutStatus,
          counterparty: maskPhone(burn.recipientPhone),
          submittedAt: isoStr(burn.burnAt), confirmedAt: isoStr(burn.approvedAt), completedAt: isoStr(burn.secondApprovedAt),
          approvals: (burn.approvedAt ? 1 : 0) + (burn.secondApprovedAt ? 1 : 0),
        }
      }
      return {
        ...r,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        provenance,
      }
    }),
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
    attestations: attestationRows.map(a => ({
      reportDate: a.reportDate,
      ntzsCirculation: Number(a.ntzsCirculation),
      tzsCustodialReserve: Number(a.tzsCustodialReserve),
      tzsGovtSecurities: Number(a.tzsGovtSecurities),
      reserveTotal: Number(a.reserveTotal),
      deviationPct: Number(a.deviationPct),
      fullyBacked: a.fullyBacked,
      reportHash: a.reportHash,
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    })),
  }

  return <OversightPortal data={data} />
}
