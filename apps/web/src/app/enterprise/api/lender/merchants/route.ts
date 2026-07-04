import { NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts, enterpriseLoanAgreements } from '@ntzs/db'
import { eq, desc, inArray } from 'drizzle-orm'
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

  // The lender's book is the loan-agreement history, NOT the live
  // merchant→lender link: loan closure clears lender_partner_id, so keying on
  // it made fully-repaid borrowers vanish from the portal with no record.
  const agreements = await db
    .select({
      merchantId: enterpriseLoanAgreements.merchantId,
      loanId: enterpriseLoanAgreements.id,
      principalTzs: enterpriseLoanAgreements.principalTzs,
      interestRatePct: enterpriseLoanAgreements.interestRatePct,
      interestTzs: enterpriseLoanAgreements.interestTzs,
      totalOwedTzs: enterpriseLoanAgreements.totalOwedTzs,
      repaidTzs: enterpriseLoanAgreements.repaidTzs,
      disbursedTzs: enterpriseLoanAgreements.disbursedTzs,
      termDays: enterpriseLoanAgreements.termDays,
      dueAt: enterpriseLoanAgreements.dueAt,
      loanStartedAt: enterpriseLoanAgreements.createdAt,
      loanStatus: enterpriseLoanAgreements.status,
    })
    .from(enterpriseLoanAgreements)
    .where(eq(enterpriseLoanAgreements.partnerId, account.partnerId))
    .orderBy(desc(enterpriseLoanAgreements.createdAt))

  // One loan per merchant: the active one if any, else the most recent.
  const loanByMerchant = new Map<string, (typeof agreements)[number]>()
  for (const a of agreements) {
    const existing = loanByMerchant.get(a.merchantId)
    if (!existing || (a.loanStatus === 'active' && existing.loanStatus !== 'active')) {
      loanByMerchant.set(a.merchantId, a)
    }
  }

  const linked = await db
    .select({ id: merchantAccounts.id })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.lenderPartnerId, account.partnerId))
  const merchantIds = [...new Set([...loanByMerchant.keys(), ...linked.map((m) => m.id)])]

  if (!merchantIds.length) return NextResponse.json({ merchants: [] })

  const accounts = await db
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
      lenderPartnerId: merchantAccounts.lenderPartnerId,
    })
    .from(merchantAccounts)
    .where(inArray(merchantAccounts.id, merchantIds))

  const merchants = accounts.map((m) => {
    const loan = loanByMerchant.get(m.id) ?? null
    return {
      id: m.id,
      businessName: m.businessName,
      handle: m.handle,
      walletAddress: m.walletAddress,
      settlePct: m.settlePct,
      // Post-payoff the live link is cleared; report the split only while linked.
      lenderSplitPct: m.lenderPartnerId === account.partnerId ? m.lenderSplitPct : 0,
      lenderPendingTzs: m.lenderPartnerId === account.partnerId ? m.lenderPendingTzs : 0,
      lenderControlsSettlement: m.lenderPartnerId === account.partnerId ? m.lenderControlsSettlement : false,
      withdrawalLimitTzs: m.lenderPartnerId === account.partnerId ? m.withdrawalLimitTzs : 0,
      isActive: m.isActive,
      loanId: loan?.loanId ?? null,
      principalTzs: loan?.principalTzs ?? null,
      interestRatePct: loan?.interestRatePct ?? null,
      interestTzs: loan?.interestTzs ?? null,
      totalOwedTzs: loan?.totalOwedTzs ?? null,
      repaidTzs: loan?.repaidTzs ?? null,
      disbursedTzs: loan?.disbursedTzs ?? null,
      termDays: loan?.termDays ?? null,
      dueAt: loan?.dueAt ?? null,
      loanStartedAt: loan?.loanStartedAt ?? null,
      loanStatus: loan?.loanStatus ?? null,
    }
  })

  return NextResponse.json({ merchants })
}
