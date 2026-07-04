/**
 * Pure money rule for the balance-driven lender payoff (settlement Phase F).
 * Kept free of chain/DB imports so it can be unit-tested in isolation.
 */

/**
 * Minimum accrued lender share before the drip fires an on-chain transfer
 * (settlement Phase D). Exported so API responses can tell clients how far the
 * merchant is from the next automatic transfer.
 */
export const MIN_LENDER_REPAYMENT_TZS = 1000

/**
 * Decide how much nTZS to move to pay off a lender loan from the merchant's
 * on-chain balance.
 *
 * Rule: only pay off when the wallet holds the FULL outstanding balance —
 * partial sweeps stay the per-sale drip's job — and never transfer more than
 * what is still owed. Returns 0 when nothing is owed or the balance can't cover
 * the whole loan.
 */
export function computeLoanPayoffTzs(params: {
  totalOwedTzs: number
  repaidTzs: number
  balanceTzs: number
}): number {
  const outstanding = params.totalOwedTzs - params.repaidTzs
  if (outstanding <= 0) return 0
  if (params.balanceTzs < outstanding) return 0
  return outstanding
}
