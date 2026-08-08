import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';
import { actionDisposition, createApproval } from '@/lib/fx/approvals';

/**
 * PATCH /api/lp/spread — set the LP's bid/ask spread.
 *
 * This is the endpoint the Spread page uses, and it used to apply the change
 * with no role check and no maker-checker at all: a viewer, who is read-only
 * by definition, could reprice the book, and an operator's change bypassed the
 * approval that PUT /lp/fx-config would have queued. The Approvals screen
 * advertises `set_fx` as a gated action, so the control existed on paper while
 * the screen a bank actually uses every day went straight through. Same policy
 * as fx-config now: owner/approver direct, operator queued, viewer denied.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bidBps, askBps } = await req.json();

  if (
    typeof bidBps !== 'number' || typeof askBps !== 'number' ||
    bidBps < 10 || bidBps > 500 || askBps < 10 || askBps > 500
  ) {
    return NextResponse.json({ error: 'Invalid spread values (10–500 bps each)' }, { status: 400 });
  }

  const disposition = actionDisposition(session.role);
  if (disposition === 'deny') {
    return NextResponse.json({ error: 'Your role does not permit changing the spread.' }, { status: 403 });
  }
  if (disposition === 'queue') {
    // Carry the LP's current limits into the payload. A `set_fx` approval
    // applies the whole payload on release, so queueing without them would
    // silently clear the exposure limits when an approver said yes to what
    // looked like a spread change.
    const [current] = await db
      .select({ limits: lpAccounts.limits })
      .from(lpAccounts)
      .where(eq(lpAccounts.id, session.lpId))
      .limit(1);
    await createApproval({
      lpId: session.lpId,
      action: 'set_fx',
      payload: { bidBps, askBps, limits: current?.limits ?? null },
      memberId: session.memberId,
    });
    return NextResponse.json({ ok: true, pending: true, message: 'Spread change submitted to an approver.' });
  }

  // Note: no onboardingStep here. This used to write `onboardingStep: 3`, so a
  // fully onboarded bank that adjusted its rate was thrown back into the
  // wizard at "Banking & reserve" — a step that does not prefill, making it
  // look as though its details had been lost.
  const [updated] = await db
    .update(lpAccounts)
    .set({ bidBps, askBps, updatedAt: new Date() })
    .where(eq(lpAccounts.id, session.lpId))
    .returning();

  return NextResponse.json({ lp: updated });
}
