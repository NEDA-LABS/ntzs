import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/merchant/db'
import { enterpriseLoanAgreements, merchantAccounts, partners } from '@ntzs/db'
import { MIN_LENDER_REPAYMENT_TZS } from '@/lib/settlement-payoff'

export interface CapitalSummary {
  lenderName: string | null
  lenderSplitPct: number
  loanStatus: 'active'
  principalTzs: number
  totalOwedTzs: number
  repaidTzs: number
  outstandingTzs: number
  /** Accrued lender share (lender_pending_tzs) waiting to cross the transfer threshold. */
  collectedTowardNextTransferTzs: number
  transferThresholdTzs: number
}

/**
 * The merchant's live capital-repayment picture: how much of the lender loan is
 * still outstanding and how much of each sale's lender cut has accrued toward
 * the next automatic wallet→lender transfer. Returns null when the merchant has
 * no active lender loan (nothing being repaid). Shared by the in-app merchant
 * stats route and the NEDApay service-layer (biashara) stats route so both
 * frontends can show repayment progress instead of guessing from the
 * settlement pot.
 */
export async function getCapitalSummary(merchantId: string): Promise<CapitalSummary | null> {
  const [merchant] = await db
    .select({
      lenderPartnerId: merchantAccounts.lenderPartnerId,
      lenderSplitPct: merchantAccounts.lenderSplitPct,
      lenderPendingTzs: merchantAccounts.lenderPendingTzs,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant?.lenderPartnerId) return null

  const [loan] = await db
    .select({
      principalTzs: enterpriseLoanAgreements.principalTzs,
      totalOwedTzs: enterpriseLoanAgreements.totalOwedTzs,
      repaidTzs: enterpriseLoanAgreements.repaidTzs,
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

  if (!loan) return null

  const [lender] = await db
    .select({ name: partners.name })
    .from(partners)
    .where(eq(partners.id, merchant.lenderPartnerId))
    .limit(1)

  return {
    lenderName: lender?.name ?? null,
    lenderSplitPct: merchant.lenderSplitPct,
    loanStatus: 'active',
    principalTzs: loan.principalTzs,
    totalOwedTzs: loan.totalOwedTzs,
    repaidTzs: loan.repaidTzs,
    outstandingTzs: Math.max(0, loan.totalOwedTzs - loan.repaidTzs),
    collectedTowardNextTransferTzs: merchant.lenderPendingTzs,
    transferThresholdTzs: MIN_LENDER_REPAYMENT_TZS,
  }
}
