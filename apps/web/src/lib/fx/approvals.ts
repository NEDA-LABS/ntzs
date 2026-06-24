import { eq } from 'drizzle-orm';

import { db } from '@/lib/fx/db';
import { lpApprovals, lpAccounts } from '@ntzs/db';

export type ApprovalAction = 'set_fx' | 'set_banking';

/**
 * Maker-checker policy. Operators are "makers": their gated actions must be approved
 * by a checker (owner or approver). Owners and approvers act directly.
 */
export function needsApproval(role: string | undefined): boolean {
  return role === 'operator';
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

/** Execute an approved action's stored payload. */
export async function applyApproval(action: string, lpId: string, payload: unknown): Promise<void> {
  if (action === 'set_fx') {
    const p = payload as { bidBps: number; askBps: number; limits?: unknown };
    await db
      .update(lpAccounts)
      .set({ bidBps: p.bidBps, askBps: p.askBps, limits: (p.limits ?? null) as Record<string, unknown> | null, updatedAt: new Date() })
      .where(eq(lpAccounts.id, lpId));
  } else if (action === 'set_banking') {
    await db
      .update(lpAccounts)
      .set({ bankingProfile: payload as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(lpAccounts.id, lpId));
  }
}
