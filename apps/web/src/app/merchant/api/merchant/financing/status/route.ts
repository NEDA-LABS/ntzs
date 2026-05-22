import { NextResponse } from 'next/server'
import { db } from '@/lib/merchant/db'
import {
  merchantAccounts,
  enterpriseAccounts,
  enterpriseMerchantApplications,
  enterpriseLoanAgreements,
  partners,
} from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/merchant/auth'

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [merchant] = await db
    .select({
      lenderPartnerId: merchantAccounts.lenderPartnerId,
      lenderSplitPct: merchantAccounts.lenderSplitPct,
      lenderControlsSettlement: merchantAccounts.lenderControlsSettlement,
      withdrawalLimitTzs: merchantAccounts.withdrawalLimitTzs,
      settlePct: merchantAccounts.settlePct,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, session.merchantId))
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Lender name (if linked)
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
          eq(enterpriseLoanAgreements.merchantId, session.merchantId),
          eq(enterpriseLoanAgreements.partnerId, merchant.lenderPartnerId),
          eq(enterpriseLoanAgreements.status, 'active')
        )
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

  // Pending invite from a lender
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
        eq(enterpriseMerchantApplications.merchantId, session.merchantId),
        eq(enterpriseMerchantApplications.direction, 'invite'),
        eq(enterpriseMerchantApplications.status, 'pending')
      )
    )
    .limit(1)

  // Pending application (merchant applied)
  const [pendingApplication] = await db
    .select({ id: enterpriseMerchantApplications.id, createdAt: enterpriseMerchantApplications.createdAt })
    .from(enterpriseMerchantApplications)
    .where(
      and(
        eq(enterpriseMerchantApplications.merchantId, session.merchantId),
        eq(enterpriseMerchantApplications.direction, 'application'),
        eq(enterpriseMerchantApplications.status, 'pending')
      )
    )
    .limit(1)

  return NextResponse.json({
    isUnderLender: !!merchant.lenderPartnerId,
    lenderName,
    lenderSplitPct: merchant.lenderSplitPct,
    lenderControlsSettlement: merchant.lenderControlsSettlement,
    withdrawalLimitTzs: merchant.withdrawalLimitTzs,
    settlePct: merchant.settlePct,
    loan: lenderName ? { loanStatus, principalTzs, totalOwedTzs, repaidTzs, interestRatePct } : null,
    pendingInvite: pendingInvite ?? null,
    pendingApplication: pendingApplication ?? null,
  })
}
