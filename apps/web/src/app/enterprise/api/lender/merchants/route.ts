import { NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts, enterpriseLoanAgreements } from '@ntzs/db'
import { eq, and, sql } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [account] = await db
    .select({ partnerId: enterpriseAccounts.partnerId, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account?.partnerId) return NextResponse.json({ error: 'No partner linked' }, { status: 403 })
  if (account.type !== 'capital_lender') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const merchants = await db
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
      isActive: merchantAccounts.isActive,
      // Loan agreement fields
      loanId: enterpriseLoanAgreements.id,
      principalTzs: enterpriseLoanAgreements.principalTzs,
      interestRatePct: enterpriseLoanAgreements.interestRatePct,
      interestTzs: enterpriseLoanAgreements.interestTzs,
      totalOwedTzs: enterpriseLoanAgreements.totalOwedTzs,
      repaidTzs: enterpriseLoanAgreements.repaidTzs,
      loanStatus: enterpriseLoanAgreements.status,
    })
    .from(merchantAccounts)
    .leftJoin(
      enterpriseLoanAgreements,
      and(
        eq(enterpriseLoanAgreements.merchantId, merchantAccounts.id),
        eq(enterpriseLoanAgreements.partnerId, account.partnerId),
        eq(enterpriseLoanAgreements.status, 'active')
      )
    )
    .where(eq(merchantAccounts.lenderPartnerId, account.partnerId))

  return NextResponse.json({ merchants })
}
