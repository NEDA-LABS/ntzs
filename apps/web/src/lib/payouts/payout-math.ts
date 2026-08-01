/**
 * Pure money rules for the burn/payout engine. Kept free of chain/DB/PSP
 * imports so the arithmetic is unit-tested in isolation — these numbers decide
 * how much cash lands on the recipient's phone.
 *
 * (The per-sale auto-settlement gross-up used to live here too; that product
 * is retired — sales stay as nTZS and cash-out is explicit via withdrawals.)
 */

/** Snippe's flat fee per mobile-money payout. Since 1 Aug 2026 this is the
 * FALLBACK only — call sites price the PSP fee on the expected serving rail
 * (expectedPayoutFeeTzs) and persist it on the row (psp_fee_tzs); rows minted
 * before per-rail pricing carry null and back out this flat fee, which is
 * exactly what their gross-up charged. */
export const SNIPPE_FLAT_FEE_TZS = 1500

/** Default platform fee on withdrawals (percent), matching consumer off-ramp. */
export const WITHDRAWAL_FEE_PCT = 0.5

/** Minimum net withdrawal, matching the consumer off-ramp (/api/v1/withdrawals). */
export const MIN_WITHDRAWAL_TZS = 5000

/**
 * Gross up an explicit withdrawal so the recipient receives exactly
 * `receiveTzs` net: burn enough nTZS to cover the net payout + the PSP fee +
 * the platform fee. Same formula as the consumer off-ramp. `pspFeeTzs` is the
 * serving rail's charge (pass expectedPayoutFeeTzs(receiveTzs)); the default
 * keeps legacy callers on the Snippe flat fee.
 *
 * Invariant: burnAmountTzs = receiveTzs + pspFeeTzs + platformFeeTzs.
 */
export function grossUpWithdrawal(
  receiveTzs: number,
  feePercent: number = WITHDRAWAL_FEE_PCT,
  pspFeeTzs: number = SNIPPE_FLAT_FEE_TZS,
): { burnAmountTzs: number; platformFeeTzs: number; pspFeeTzs: number } {
  const burnAmountTzs = Math.ceil((receiveTzs + pspFeeTzs) / (1 - feePercent / 100))
  return { burnAmountTzs, platformFeeTzs: burnAmountTzs - receiveTzs - pspFeeTzs, pspFeeTzs }
}

/**
 * The net amount the recipient receives for a burn request. Grossed-up
 * requests (platform_fee_tzs set) back out the fees — including the NEDA
 * protocol fee, which is burned on top and must not reach the recipient.
 * The PSP fee backed out is the row's own psp_fee_tzs (what the gross-up
 * actually charged); rows minted before per-rail pricing carry null and use
 * the Snippe flat fee they were priced with. Legacy requests (no platform
 * fee) pay the full burn amount. Never negative.
 */
export function netPayoutTzs(job: { amountTzs: number; platformFeeTzs: number | null; nedaFeeTzs?: number | null; pspFeeTzs?: number | null }): number {
  if (job.platformFeeTzs == null) return Math.max(0, job.amountTzs)
  return Math.max(0, job.amountTzs - job.platformFeeTzs - (job.nedaFeeTzs ?? 0) - (job.pspFeeTzs ?? SNIPPE_FLAT_FEE_TZS))
}
