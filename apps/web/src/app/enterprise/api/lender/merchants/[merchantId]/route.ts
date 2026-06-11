import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts, enterpriseLoanAgreements, transfers } from '@ntzs/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

/**
 * GET /enterprise/api/lender/merchants/[merchantId]
 * Drill-down for one merchant in the lender's book: profile, active loan,
 * computed metrics, and repayment history.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params

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

  const [merchant] = await db
    .select({
      id: merchantAccounts.id,
      businessName: merchantAccounts.businessName,
      handle: merchantAccounts.handle,
      walletAddress: merchantAccounts.walletAddress,
      settlePct: merchantAccounts.settlePct,
      lenderSplitPct: merchantAccounts.lenderSplitPct,
      lenderPendingTzs: merchantAccounts.lenderPendingTzs,
      lenderControlsSettlement: merchantAccounts.lenderControlsSettlement,
      withdrawalLimitTzs: merchantAccounts.withdrawalLimitTzs,
      lenderPartnerId: merchantAccounts.lenderPartnerId,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant || merchant.lenderPartnerId !== account.partnerId) {
    return NextResponse.json({ error: 'Merchant not linked to this lender' }, { status: 404 })
  }

  const [loan] = await db
    .select({
      id: enterpriseLoanAgreements.id,
      principalTzs: enterpriseLoanAgreements.principalTzs,
      interestRatePct: enterpriseLoanAgreements.interestRatePct,
      interestTzs: enterpriseLoanAgreements.interestTzs,
      totalOwedTzs: enterpriseLoanAgreements.totalOwedTzs,
      repaidTzs: enterpriseLoanAgreements.repaidTzs,
      disbursedTzs: enterpriseLoanAgreements.disbursedTzs,
      termDays: enterpriseLoanAgreements.termDays,
      dueAt: enterpriseLoanAgreements.dueAt,
      status: enterpriseLoanAgreements.status,
      createdAt: enterpriseLoanAgreements.createdAt,
    })
    .from(enterpriseLoanAgreements)
    .where(
      and(
        eq(enterpriseLoanAgreements.merchantId, merchantId),
        eq(enterpriseLoanAgreements.partnerId, account.partnerId),
        eq(enterpriseLoanAgreements.status, 'active'),
      ),
    )
    .limit(1)

  const repayments = await db
    .select({
      id: transfers.id,
      amountTzs: transfers.amountTzs,
      status: transfers.status,
      txHash: transfers.txHash,
      createdAt: transfers.createdAt,
    })
    .from(transfers)
    .where(
      and(
        eq(transfers.partnerId, account.partnerId),
        sql`${transfers.metadata}->>'reason' = 'lender_repayment'`,
        sql`${transfers.metadata}->>'merchantId' = ${merchantId}`,
      ),
    )
    .orderBy(desc(transfers.createdAt))
    .limit(100)

  let metrics: Record<string, number | null> | null = null
  if (loan) {
    const drawnOutstanding = Math.max(0, loan.disbursedTzs - loan.repaidTzs)
    const availableToDrawTzs = Math.max(0, loan.principalTzs - (loan.disbursedTzs - loan.repaidTzs))
    const utilizationPct = loan.principalTzs > 0 ? (loan.disbursedTzs / loan.principalTzs) * 100 : 0
    const interestRealizedTzs = loan.totalOwedTzs > 0 ? Math.round(loan.repaidTzs * (loan.interestTzs / loan.totalOwedTzs)) : 0
    const daysToDue = loan.dueAt ? Math.round((new Date(loan.dueAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null
    metrics = { drawnOutstanding, availableToDrawTzs, utilizationPct, interestRealizedTzs, daysToDue }
  }

  return NextResponse.json({ merchant, loan: loan ?? null, metrics, repayments })
}
