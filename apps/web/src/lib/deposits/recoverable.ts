/**
 * Which deposit statuses a CONFIRMED PSP collection may still advance.
 *
 * ⚠ WHY 'rejected' AND 'cancelled' ARE IN THIS LIST. Both payment webhooks
 * used to accept 'submitted' only. On 4 Aug 2026 a customer's 105,000 TZS
 * collection failed to initiate cleanly on our side, so the row was closed as
 * `rejected`; the PSP had dispatched the prompt anyway and the customer paid.
 * The completion webhook then found a non-'submitted' row and discarded the
 * event. The money sat in our PSP account, unminted and unalerted, until the
 * customer complained ~15 hours later.
 *
 * Our own record of a failure is a WEAKER signal than the PSP telling us it
 * collected. When those two disagree, the PSP wins and we re-open the deposit
 * — the amount and currency cross-checks at each call site are what make that
 * safe, not the status guard.
 *
 * Statuses NOT in this list (mint_pending, mint_requires_safe, mint_processing,
 * minted) are deliberately excluded: those are already on their way to a mint,
 * and re-advancing them is how a deposit gets minted twice.
 */
export const RECOVERABLE_DEPOSIT_STATUSES = ['submitted', 'rejected', 'cancelled'] as const

export type RecoverableDepositStatus = (typeof RECOVERABLE_DEPOSIT_STATUSES)[number]

/** True when the status is one a confirmed collection may still advance. */
export function isRecoverableDepositStatus(status: string): boolean {
  return (RECOVERABLE_DEPOSIT_STATUSES as readonly string[]).includes(status)
}

/** True when advancing this row means recovering money we had written off. */
export function isRecoveryAdvance(previousStatus: string): boolean {
  return previousStatus === 'rejected' || previousStatus === 'cancelled'
}
