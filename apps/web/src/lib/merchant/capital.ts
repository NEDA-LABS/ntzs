import { desc, eq } from 'drizzle-orm'

import { db } from '@/lib/merchant/db'
import { enterpriseLoanAgreements, merchantAccounts, partners } from '@ntzs/db'
import { MIN_LENDER_REPAYMENT_TZS } from '@/lib/settlement-payoff'

export interface CapitalSummary {
  lenderName: string | null
  lenderSplitPct: number
  /** 'active' while repaying; 'repaid'/'defaulted'/… once closed. */
  loanStatus: string
  principalTzs: number
  totalOwedTzs: number
  repaidTzs: number
  outstandingTzs: number
  /** Accrued lender share (lender_pending_tzs) waiting to cross the transfer threshold. */
  collectedTowardNextTransferTzs: number
  transferThresholdTzs: number
  /** When the loan record was last touched — for a closed loan, its payoff date. */
  updatedAt: Date | null
}

/**
 * The merchant's live capital-repayment picture: how much of the lender loan is
 * still outstanding and how much of each sale's lender cut has accrued toward
 * the next automatic wallet→lender transfer. Falls back to the most recent
 * closed loan (loanStatus 'repaid' etc.) so a paid-off loan leaves a record
 * instead of vanishing — full repayment clears the live merchant→lender link,
 * so this is keyed on the loan-agreement history, not that link. Returns null
 * only for merchants who never had a loan. Shared by the in-app merchant stats
 * route and the NEDApay service-layer (biashara) stats route.
 */
export async function getCapitalSummary(merchantId: string): Promise<CapitalSummary | null> {
  const loans = await db
    .select({
      partnerId: enterpriseLoanAgreements.partnerId,
      status: enterpriseLoanAgreements.status,
      principalTzs: enterpriseLoanAgreements.principalTzs,
      totalOwedTzs: enterpriseLoanAgreements.totalOwedTzs,
      repaidTzs: enterpriseLoanAgreements.repaidTzs,
      updatedAt: enterpriseLoanAgreements.updatedAt,
    })
    .from(enterpriseLoanAgreements)
    .where(eq(enterpriseLoanAgreements.merchantId, merchantId))
    .orderBy(desc(enterpriseLoanAgreements.createdAt))
    .limit(10)

  const loan = loans.find((l) => l.status === 'active') ?? loans[0]
  if (!loan) return null

  const [merchant] = await db
    .select({
      lenderPartnerId: merchantAccounts.lenderPartnerId,
      lenderSplitPct: merchantAccounts.lenderSplitPct,
      lenderPendingTzs: merchantAccounts.lenderPendingTzs,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  const [lender] = await db
    .select({ name: partners.name })
    .from(partners)
    .where(eq(partners.id, loan.partnerId))
    .limit(1)

  const isLive = loan.status === 'active' && merchant?.lenderPartnerId === loan.partnerId

  return {
    lenderName: lender?.name ?? null,
    lenderSplitPct: isLive ? (merchant?.lenderSplitPct ?? 0) : 0,
    loanStatus: loan.status,
    principalTzs: loan.principalTzs,
    totalOwedTzs: loan.totalOwedTzs,
    repaidTzs: loan.repaidTzs,
    outstandingTzs: loan.status === 'active' ? Math.max(0, loan.totalOwedTzs - loan.repaidTzs) : 0,
    collectedTowardNextTransferTzs: isLive ? (merchant?.lenderPendingTzs ?? 0) : 0,
    transferThresholdTzs: MIN_LENDER_REPAYMENT_TZS,
    updatedAt: loan.updatedAt ?? null,
  }
}
