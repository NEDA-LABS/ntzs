import { eq } from 'drizzle-orm';

import { db } from '@/lib/fx/db';
import { lpApprovals, lpAccounts } from '@ntzs/db';
import { executeWithdraw, type WithdrawParams } from '@/lib/fx/withdraw';

export type ApprovalAction = 'set_fx' | 'set_banking' | 'withdraw';

export type ActionDisposition = 'direct' | 'queue' | 'deny';

/**
 * Maker-checker + least-privilege policy for gated mutating actions
 * (withdraw, set_fx, set_banking):
 *   - owner / approver (and legacy sessions with no role) are checkers -> act directly.
 *   - operator is a maker -> the action is queued for a checker to approve.
 *   - viewer (and any unrecognized role) is read-only -> denied.
 *
 * Callers MUST treat 'deny' as a hard 403. This replaces the previous
 * `needsApproval` predicate, which only queued operators and let every other
 * non-owner role (including the read-only `viewer`) fall through to direct
 * execution — allowing a viewer to move LP funds and rewrite spreads/banking.
 */
export function actionDisposition(role: string | undefined): ActionDisposition {
  if (role === undefined || role === 'owner' || role === 'approver') return 'direct';
  if (role === 'operator') return 'queue';
  return 'deny';
}

export function canDecide(role: string | undefined): boolean {
  // undefined = legacy session = owner.
  return !role || role === 'owner' || role === 'approver';
}

/** Queue a maker's gated action for approval. */
export async function createApproval(opts: {
  lpId: string;
  action: ApprovalAction;
  payload: unknown;
  memberId?: string;
}): Promise<void> {
  await db.insert(lpApprovals).values({
    lpId: opts.lpId,
    action: opts.action,
    payload: opts.payload as Record<string, unknown>,
    requestedByMemberId: opts.memberId ?? null,
    status: 'pending',
  });
}

export interface ApplyResult { ok: boolean; error?: string; txHash?: string }

/** Execute an approved action's stored payload. */
export async function applyApproval(action: string, lpId: string, payload: unknown): Promise<ApplyResult> {
  if (action === 'set_fx') {
    const p = payload as { bidBps: number; askBps: number; limits?: unknown };
    await db
      .update(lpAccounts)
      .set({ bidBps: p.bidBps, askBps: p.askBps, limits: (p.limits ?? null) as Record<string, unknown> | null, updatedAt: new Date() })
      .where(eq(lpAccounts.id, lpId));
    return { ok: true };
  }
  if (action === 'set_banking') {
    await db
      .update(lpAccounts)
      .set({ bankingProfile: payload as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(lpAccounts.id, lpId));
    return { ok: true };
  }
  if (action === 'withdraw') {
    const r = await executeWithdraw(lpId, payload as WithdrawParams);
    return { ok: r.ok, error: r.error, txHash: r.txHash };
  }
  return { ok: false, error: `Unknown action: ${action}` };
}
