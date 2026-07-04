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
export function actionDisposition(role: string | undefined): ActionDisposition {
  if (role === undefined || role === 'owner' || role === 'approver') return 'direct';
  if (role === 'operator') return 'queue';
  return 'deny';
}

/** Who may decide (approve/reject) a queued action. undefined = legacy = owner. */
export function canDecide(role: string | undefined): boolean {
  return !role || role === 'owner' || role === 'approver';
}
