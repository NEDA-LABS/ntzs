/**
 * Pure money rules for the burn/payout engine. Kept free of chain/DB/network
 * imports so the arithmetic is unit-tested in isolation — these numbers decide
 * how much cash lands on the recipient's phone. (@ntzs/psp/fees is equally
 * pure: the per-provider fee tables, no I/O.)
 *
 * Multi-PSP: the PSP fee is a PARAMETER, resolved for the routed provider at
 * request-creation time (see getPayoutRoute in '@/lib/psp') and stamped onto
 * the record as psp_fee_tzs. Executors read the stamp — never recompute — so
 * a routing/fee change can't alter what the user was quoted. Defaults keep
 * the historical Snippe flat fee for legacy callers/records.
 */

import { SNIPPE_FLAT_FEE_TZS, getPayoutFeeTzs } from '@ntzs/psp/fees'

export { SNIPPE_FLAT_FEE_TZS, getPayoutFeeTzs }

/** Default platform fee on withdrawals (percent), matching consumer off-ramp. */
export const WITHDRAWAL_FEE_PCT = 0.5

/** Minimum net withdrawal, matching the consumer off-ramp (/api/v1/withdrawals). */
export const MIN_WITHDRAWAL_TZS = 5000

/**
 * Gross up an explicit withdrawal so the recipient receives exactly
 * `receiveTzs` net: burn enough nTZS to cover the net payout + the PSP fee
 * + the platform fee. Same formula as the consumer off-ramp.
 *
 * Invariant: burnAmountTzs = receiveTzs + pspFeeTzs + platformFeeTzs.
 */
export function grossUpWithdrawal(
  receiveTzs: number,
  feePercent: number = WITHDRAWAL_FEE_PCT,
  pspFeeTzs: number = SNIPPE_FLAT_FEE_TZS,
): { burnAmountTzs: number; platformFeeTzs: number } {
  const burnAmountTzs = Math.ceil((receiveTzs + pspFeeTzs) / (1 - feePercent / 100))
  return { burnAmountTzs, platformFeeTzs: burnAmountTzs - receiveTzs - pspFeeTzs }
}

/**
 * The net amount the recipient receives for a burn request. Grossed-up
 * requests (platform_fee_tzs set) back out the fees; legacy requests pay the
 * full burn amount. `pspFeeTzs` is the fee stamped on the record
 * (burn_requests.psp_fee_tzs); NULL/absent = legacy Snippe flat fee.
 * Never negative.
 */
export function netPayoutTzs(job: {
  amountTzs: number
  platformFeeTzs: number | null
  pspFeeTzs?: number | null
}): number {
  if (job.platformFeeTzs == null) return Math.max(0, job.amountTzs)
  return Math.max(0, job.amountTzs - job.platformFeeTzs - (job.pspFeeTzs ?? SNIPPE_FLAT_FEE_TZS))
}
