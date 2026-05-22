import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts, enterpriseLoanAgreements } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
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
    .select({ lenderPartnerId: merchantAccounts.lenderPartnerId })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant || merchant.lenderPartnerId !== account.partnerId) {
    return NextResponse.json({ error: 'Merchant not linked to this lender' }, { status: 404 })
  }

  const [loan] = await db
    .select({ id: enterpriseLoanAgreements.id, repaidTzs: enterpriseLoanAgreements.repaidTzs, principalTzs: enterpriseLoanAgreements.principalTzs })
    .from(enterpriseLoanAgreements)
    .where(
      and(
        eq(enterpriseLoanAgreements.merchantId, merchantId),
        eq(enterpriseLoanAgreements.partnerId, account.partnerId),
        eq(enterpriseLoanAgreements.status, 'active')
      )
    )
    .limit(1)

  if (!loan) return NextResponse.json({ error: 'No active loan agreement found' }, { status: 404 })
  if (loan.repaidTzs > 0) {
    return NextResponse.json({ error: 'Cannot change interest rate after repayments have started' }, { status: 409 })
  }

  const body = await req.json()
  const interestRatePct = Number(body.interestRatePct ?? 0)

  if (!Number.isInteger(interestRatePct) || interestRatePct < 0 || interestRatePct > 200) {
    return NextResponse.json({ error: 'interestRatePct must be 0–200' }, { status: 400 })
  }

  const interestTzs = Math.floor(loan.principalTzs * interestRatePct / 100)
  const totalOwedTzs = loan.principalTzs + interestTzs

  await db
    .update(enterpriseLoanAgreements)
    .set({ interestRatePct, interestTzs, totalOwedTzs, updatedAt: new Date() })
    .where(eq(enterpriseLoanAgreements.id, loan.id))

  return NextResponse.json({ ok: true, interestRatePct, interestTzs, totalOwedTzs })
}
