export type ActionDisposition = 'direct' | 'queue' | 'deny';

/**
 * Maker-checker + least-privilege policy for gated mutating LP actions
 * (withdraw, set_fx, set_banking). Pure — no DB/network — so it is unit-testable
 * in isolation.
 *
 *   - owner / approver (and legacy sessions with no role) are checkers -> act directly
 *   - operator is a maker -> the action is queued for a checker to approve
 *   - viewer (and any unrecognized role) is read-only -> denied
 *
 * Callers MUST treat 'deny' as a hard 403. This replaced the previous
 * `needsApproval` predicate, which only queued operators and let every other
 * non-owner role (including the read-only `viewer`) fall through to direct
 * execution — allowing a viewer to move LP funds and rewrite spreads/banking.
 */
export function actionDisposition(
  role: string | undefined,
  /**
   * Optional value ceiling. When the LP has set a threshold and this action is
   * worth at least that much, it queues for a second approver REGARDLESS of
   * role — including the owner's own. Self-approval is refused downstream, so
   * the ceiling is a real four-eyes control rather than a formality.
   *
   * Currency-agnostic on purpose: a shilling cash-out is measured against the
   * TZS ceiling and a stablecoin transfer against the USD one, but the rule is
   * identical and the caller picks the pair. Passing an amount in one currency
   * against a threshold in another would silently mis-gate, so they travel
   * together in a single argument.
   */
  value?: { amount?: number | null; threshold?: number | null },
): ActionDisposition {
  if (role !== undefined && role !== 'owner' && role !== 'approver' && role !== 'operator') return 'deny';
  if (role === 'operator') return 'queue';

  const threshold = value?.threshold;
  const amount = value?.amount;
  if (
    typeof threshold === 'number' && threshold > 0 &&
    typeof amount === 'number' && Number.isFinite(amount) &&
    amount >= threshold
  ) {
    return 'queue';
  }
  return 'direct';
}

/**
 * May this role take an operational action that moves the account's own funds
 * between its wallet and the solver — activate and deactivate?
 *
 * Deliberately NOT actionDisposition: that returns 'queue' for an operator,
 * and 'activate' is not an ApprovalAction, so a queued one could never be
 * executed. The only thing that must be true here is that a viewer — read-only
 * by definition — cannot do it, which is exactly the hole this closes.
 */
export function canOperate(role: string | undefined): boolean {
  return !role || role === 'owner' || role === 'approver' || role === 'operator';
}

/**
 * May this account be live in the market?
 *
 * `status` is the field that already means "cleared to operate": granting
 * sandbox test access in Backstage sets it to 'active', and that is the
 * documented remedy for an account that needs to trade before full KYB. So the
 * gate is status, NOT kybStatus — every LP that has ever filled an order is
 * kyb_status='not_started', and gating on KYB would take the whole market
 * offline rather than secure it.
 */
export function canGoLive(status: string | undefined): boolean {
  return status === 'active';
}

/** Who may decide (approve/reject) a queued action. undefined = legacy = owner. */
export function canDecide(role: string | undefined): boolean {
  return !role || role === 'owner' || role === 'approver';
}
