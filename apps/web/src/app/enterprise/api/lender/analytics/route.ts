import { NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseLoanAgreements, transfers } from '@ntzs/db'
import { eq, and, sql } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * GET /enterprise/api/lender/analytics
 * Portfolio-level analytics for a capital lender: yield, facility utilization,
 * aging/at-risk, and a monthly repayment time-series.
 */
export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [account] = await db
    .select({ partnerId: enterpriseAccounts.partnerId, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account?.partnerId || account.type !== 'capital_lender') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const loans = await db
    .select({
      principalTzs: enterpriseLoanAgreements.principalTzs,
      interestTzs: enterpriseLoanAgreements.interestTzs,
      totalOwedTzs: enterpriseLoanAgreements.totalOwedTzs,
      repaidTzs: enterpriseLoanAgreements.repaidTzs,
      disbursedTzs: enterpriseLoanAgreements.disbursedTzs,
      dueAt: enterpriseLoanAgreements.dueAt,
      status: enterpriseLoanAgreements.status,
      createdAt: enterpriseLoanAgreements.createdAt,
    })
    .from(enterpriseLoanAgreements)
    .where(eq(enterpriseLoanAgreements.partnerId, account.partnerId))

  const now = Date.now()
  const clampPos = (n: number) => (n > 0 ? n : 0)

  let totalPrincipal = 0
  let totalInterestContracted = 0
  let totalInterestRealized = 0
  let totalRepaid = 0
  let totalDisbursed = 0
  let capitalOutstanding = 0 // disbursed − repaid (cash still out)

  const aging = { current: 0, dueSoon: 0, overdue: 0, severelyOverdue: 0 }
  let atRiskTzs = 0
  let overdueLoanCount = 0
  let activeLoanCount = 0

  for (const l of loans) {
    totalPrincipal += l.principalTzs
    totalInterestContracted += l.interestTzs
    totalRepaid += l.repaidTzs
    totalDisbursed += l.disbursedTzs

    // Interest realized so far, proportional to repayment progress.
    if (l.totalOwedTzs > 0) {
      totalInterestRealized += l.repaidTzs * (l.interestTzs / l.totalOwedTzs)
    }

    const drawnOutstanding = clampPos(l.disbursedTzs - l.repaidTzs)
    capitalOutstanding += drawnOutstanding

    if (l.status === 'active') {
      activeLoanCount += 1
      if (drawnOutstanding > 0 && l.dueAt) {
        const daysToDue = (new Date(l.dueAt).getTime() - now) / DAY_MS
        if (daysToDue >= 7) aging.current += drawnOutstanding
        else if (daysToDue >= 0) aging.dueSoon += drawnOutstanding
        else if (daysToDue >= -30) { aging.overdue += drawnOutstanding; atRiskTzs += drawnOutstanding; overdueLoanCount += 1 }
        else { aging.severelyOverdue += drawnOutstanding; atRiskTzs += drawnOutstanding; overdueLoanCount += 1 }
      } else if (drawnOutstanding > 0) {
        aging.current += drawnOutstanding // no term set yet → treat as current
      }
    }
  }

  const blendedYieldPct = totalPrincipal > 0 ? (totalInterestContracted / totalPrincipal) * 100 : 0
  const utilizationPct = totalPrincipal > 0 ? (totalDisbursed / totalPrincipal) * 100 : 0
  const recoveryPct = totalPrincipal + totalInterestContracted > 0
    ? (totalRepaid / (totalPrincipal + totalInterestContracted)) * 100
    : 0

  // Monthly repayment inflow for the last 12 months.
  const trendRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${transfers.createdAt}), 'YYYY-MM')`,
      totalTzs: sql<number>`coalesce(sum(${transfers.amountTzs}), 0)::float8`,
      count: sql<number>`count(*)::int`,
    })
    .from(transfers)
    .where(
      and(
        eq(transfers.partnerId, account.partnerId),
        sql`${transfers.metadata}->>'reason' = 'lender_repayment'`,
        sql`${transfers.createdAt} > now() - interval '12 months'`,
      ),
    )
    .groupBy(sql`date_trunc('month', ${transfers.createdAt})`)
    .orderBy(sql`date_trunc('month', ${transfers.createdAt})`)

  return NextResponse.json({
    yield: {
      blendedYieldPct,
      interestContractedTzs: Math.round(totalInterestContracted),
      interestRealizedTzs: Math.round(totalInterestRealized),
    },
    capital: {
      totalPrincipalTzs: totalPrincipal,
      totalDisbursedTzs: totalDisbursed,
      capitalOutstandingTzs: capitalOutstanding,
      totalRepaidTzs: totalRepaid,
      utilizationPct,
      recoveryPct,
    },
    risk: {
      aging,
      atRiskTzs,
      overdueLoanCount,
      activeLoanCount,
    },
    repaymentTrend: trendRows.map((r) => ({ month: r.month, totalTzs: Math.round(r.totalTzs), count: r.count })),
  })
}
