/**
 * Pure money rules for the merchant auto-settlement payout engine.
 * Kept free of chain/DB/PSP imports so the arithmetic is unit-tested in
 * isolation — these numbers decide how much nTZS is burned and how much cash
 * lands on the merchant's phone.
 */

/** Minimum accumulated settlement pot before a payout batch fires. */
export const MIN_SETTLEMENT_TZS = 5000

/** Snippe's flat fee per mobile-money payout. */
export const SNIPPE_FLAT_FEE_TZS = 1500

/** Platform fee taken on settlement payouts (0.5%). */
export const PLATFORM_FEE_PCT = 0.005

/**
 * Gross up a settlement batch so the merchant receives exactly `batchTzs` net:
 * burn enough nTZS to cover the net payout + Snippe's flat fee + the platform
 * fee. Returns the amount to burn and the platform fee component.
 *
 * Invariant: burnAmountTzs = batchTzs + SNIPPE_FLAT_FEE_TZS + platformFeeTzs.
 */
export function grossUpSettlement(batchTzs: number): { burnAmountTzs: number; platformFeeTzs: number } {
  const burnAmountTzs = Math.ceil((batchTzs + SNIPPE_FLAT_FEE_TZS) / (1 - PLATFORM_FEE_PCT))
  return { burnAmountTzs, platformFeeTzs: burnAmountTzs - batchTzs - SNIPPE_FLAT_FEE_TZS }
}

/**
 * The net amount the recipient receives for a burn request. Grossed-up
 * requests (platform_fee_tzs set) back out the fees; legacy requests pay the
 * full burn amount. Never negative.
 */
export function netPayoutTzs(job: { amountTzs: number; platformFeeTzs: number | null }): number {
  if (job.platformFeeTzs == null) return Math.max(0, job.amountTzs)
  return Math.max(0, job.amountTzs - job.platformFeeTzs - SNIPPE_FLAT_FEE_TZS)
}
