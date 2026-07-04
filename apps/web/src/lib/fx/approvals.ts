import { eq } from 'drizzle-orm';

import { db } from '@/lib/fx/db';
import { lpApprovals, lpAccounts } from '@ntzs/db';
import { executeWithdraw, type WithdrawParams } from '@/lib/fx/withdraw';

export type ApprovalAction = 'set_fx' | 'set_banking' | 'withdraw';

// Access policy (pure, unit-tested in access-policy.test.ts) lives in its own
// module so tests don't pull in the DB/ethers dependency graph.
export { actionDisposition, canDecide, type ActionDisposition } from './access-policy';

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
