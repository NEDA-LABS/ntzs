import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/merchant/db'
import {
  merchantAccounts,
  enterpriseAccounts,
  enterpriseMerchantApplications,
  enterpriseLoanAgreements,
  partners,
} from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { requireServiceKey } from '@/lib/service-auth'
import { MIN_LENDER_REPAYMENT_TZS } from '@/lib/settlement-payoff'

/**
 * GET /api/v1/biashara/financing/status  (NEDApay service layer)
 * The merchant's financing state: lender, loan, split, pending invite/application.
 * Headers: x-service-key, x-merchant-id.
 */
export async function GET(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })

  const [merchant] = await db
    .select({
      lenderPartnerId: merchantAccounts.lenderPartnerId,
      lenderSplitPct: merchantAccounts.lenderSplitPct,
      lenderPendingTzs: merchantAccounts.lenderPendingTzs,
      lenderControlsSettlement: merchantAccounts.lenderControlsSettlement,
      withdrawalLimitTzs: merchantAccounts.withdrawalLimitTzs,
      settlePct: merchantAccounts.settlePct,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let lenderName: string | null = null
  let loanStatus: string | null = null
  let principalTzs: number | null = null
  let totalOwedTzs: number | null = null
  let repaidTzs: number | null = null
  let interestRatePct: number | null = null

  if (merchant.lenderPartnerId) {
    const [lenderPartner] = await db
      .select({ name: partners.name })
      .from(partners)
      .where(eq(partners.id, merchant.lenderPartnerId))
      .limit(1)
    lenderName = lenderPartner?.name ?? null

    const [loan] = await db
      .select({
        status: enterpriseLoanAgreements.status,
        principalTzs: enterpriseLoanAgreements.principalTzs,
        totalOwedTzs: enterpriseLoanAgreements.totalOwedTzs,
        repaidTzs: enterpriseLoanAgreements.repaidTzs,
        interestRatePct: enterpriseLoanAgreements.interestRatePct,
      })
      .from(enterpriseLoanAgreements)
      .where(
        and(
          eq(enterpriseLoanAgreements.merchantId, merchantId),
          eq(enterpriseLoanAgreements.partnerId, merchant.lenderPartnerId),
          eq(enterpriseLoanAgreements.status, 'active'),
        ),
      )
      .limit(1)
    if (loan) {
      loanStatus = loan.status
      principalTzs = loan.principalTzs
      totalOwedTzs = loan.totalOwedTzs
      repaidTzs = loan.repaidTzs
      interestRatePct = loan.interestRatePct
    }
  }

  const [pendingInvite] = await db
    .select({
      id: enterpriseMerchantApplications.id,
      proposedSplitPct: enterpriseMerchantApplications.proposedSplitPct,
      message: enterpriseMerchantApplications.message,
      createdAt: enterpriseMerchantApplications.createdAt,
      enterpriseName: enterpriseAccounts.name,
    })
    .from(enterpriseMerchantApplications)
    .innerJoin(enterpriseAccounts, eq(enterpriseAccounts.id, enterpriseMerchantApplications.enterpriseId))
    .where(
      and(
        eq(enterpriseMerchantApplications.merchantId, merchantId),
        eq(enterpriseMerchantApplications.direction, 'invite'),
        eq(enterpriseMerchantApplications.status, 'pending'),
      ),
    )
    .limit(1)

  const [pendingApplication] = await db
    .select({ id: enterpriseMerchantApplications.id, createdAt: enterpriseMerchantApplications.createdAt })
    .from(enterpriseMerchantApplications)
    .where(
      and(
        eq(enterpriseMerchantApplications.merchantId, merchantId),
        eq(enterpriseMerchantApplications.direction, 'application'),
        eq(enterpriseMerchantApplications.status, 'pending'),
      ),
    )
    .limit(1)

  return NextResponse.json({
    isUnderLender: !!merchant.lenderPartnerId,
    lenderName,
    lenderSplitPct: merchant.lenderSplitPct,
    lenderControlsSettlement: merchant.lenderControlsSettlement,
    withdrawalLimitTzs: merchant.withdrawalLimitTzs,
    settlePct: merchant.settlePct,
    loan: lenderName
      ? {
          loanStatus,
          principalTzs,
          totalOwedTzs,
          repaidTzs,
          interestRatePct,
          outstandingTzs: totalOwedTzs !== null && repaidTzs !== null ? Math.max(0, totalOwedTzs - repaidTzs) : null,
          collectedTowardNextTransferTzs: merchant.lenderPendingTzs,
          transferThresholdTzs: MIN_LENDER_REPAYMENT_TZS,
        }
      : null,
    pendingInvite: pendingInvite ?? null,
    pendingApplication: pendingApplication ?? null,
  })
}
