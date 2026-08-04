/**
 * Manual-approval thresholds — the SINGLE source of truth for "how big does a
 * movement have to be before a human (Safe multi-sig / second approver) must
 * sign it".
 *
 * ⚠ WHY THIS MODULE EXISTS. These two numbers used to be copy-pasted as a
 * local `const` in twelve route files, and they had DRIFTED: nine sites said
 * 1,000,000 while five still said 100,000 (the original pilot value). Because
 * a deposit can be settled by EITHER the PSP webhook (1,000,000) or the
 * fallback poll cron (100,000), the same 150,000 TZS deposit was routed to
 * multi-sig or straight to mint depending only on which observer happened to
 * see the payment first — a non-deterministic control, and the reason users
 * depositing 100k+ were being parked for approval against policy.
 *
 * Anything that gates on a manual-approval amount MUST import from here.
 * approval-thresholds.test.ts fails the build if a new local copy appears.
 *
 * Both are overridable per environment, so raising the cap is a config change
 * rather than a deploy. A missing/garbage value falls back to the default
 * rather than to zero — a zero here would send EVERY transaction to multi-sig.
 */

function readThresholdTzs(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback
}

/** Default for both thresholds: 1,000,000 TZS (also the BoT per-transaction cap). */
export const DEFAULT_APPROVAL_THRESHOLD_TZS = 1_000_000

/**
 * Deposits at or above this mint through the Safe (`mint_requires_safe`)
 * instead of the automated minter (`mint_pending`).
 */
export const SAFE_MINT_THRESHOLD_TZS = readThresholdTzs(
  process.env.SAFE_MINT_THRESHOLD_TZS,
  DEFAULT_APPROVAL_THRESHOLD_TZS
)

/**
 * Burns (withdrawals, spends, merchant cash-outs) at or above this are queued
 * for a second approver instead of executing inline.
 */
export const SAFE_BURN_THRESHOLD_TZS = readThresholdTzs(
  process.env.SAFE_BURN_THRESHOLD_TZS,
  DEFAULT_APPROVAL_THRESHOLD_TZS
)

/** Deposit status for a confirmed payment, by amount. */
export function mintStatusForAmount(amountTzs: number): 'mint_requires_safe' | 'mint_pending' {
  return amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'
}
