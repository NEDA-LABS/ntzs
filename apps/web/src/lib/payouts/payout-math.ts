/**
 * Pure money rules for the burn/payout engine. Kept free of chain/DB/PSP
 * imports so the arithmetic is unit-tested in isolation — these numbers decide
 * how much cash lands on the recipient's phone.
 *
 * (The per-sale auto-settlement gross-up used to live here too; that product
 * is retired — sales stay as nTZS and cash-out is explicit via withdrawals.)
 */

/** Snippe's flat fee per mobile-money payout. */
export const SNIPPE_FLAT_FEE_TZS = 1500

/**
 * The net amount the recipient receives for a burn request. Grossed-up
 * requests (platform_fee_tzs set) back out the fees; legacy requests pay the
 * full burn amount. Never negative.
 */
export function netPayoutTzs(job: { amountTzs: number; platformFeeTzs: number | null }): number {
  if (job.platformFeeTzs == null) return Math.max(0, job.amountTzs)
  return Math.max(0, job.amountTzs - job.platformFeeTzs - SNIPPE_FLAT_FEE_TZS)
}
