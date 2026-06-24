import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';

import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpApprovals, lpMembers } from '@ntzs/db';
import { applyApproval, canDecide } from '@/lib/fx/approvals';

/** GET /api/lp/approvals — pending approvals for the org (with requester email). */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const approvals = await db
    .select({
      id: lpApprovals.id,
      action: lpApprovals.action,
      payload: lpApprovals.payload,
      status: lpApprovals.status,
      createdAt: lpApprovals.createdAt,
      requestedByMemberId: lpApprovals.requestedByMemberId,
      requesterEmail: lpMembers.email,
    })
    .from(lpApprovals)
    .leftJoin(lpMembers, eq(lpMembers.id, lpApprovals.requestedByMemberId))
    .where(and(eq(lpApprovals.lpId, session.lpId), eq(lpApprovals.status, 'pending')))
    .orderBy(desc(lpApprovals.createdAt));

  return NextResponse.json({
    approvals,
    you: { memberId: session.memberId ?? null, role: session.role ?? 'owner', canDecide: canDecide(session.role) },
  });
}

/** POST /api/lp/approvals — decide a pending request. Body: { approvalId, decision }. */
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canDecide(session.role)) {
    return NextResponse.json({ error: 'Only owners and approvers can decide.' }, { status: 403 });
  }

  let body: { approvalId?: string; decision?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.approvalId || (body.decision !== 'approve' && body.decision !== 'reject')) {
    return NextResponse.json({ error: 'approvalId and decision (approve|reject) are required.' }, { status: 400 });
  }

  const [appr] = await db
    .select()
    .from(lpApprovals)
    .where(and(eq(lpApprovals.id, body.approvalId), eq(lpApprovals.lpId, session.lpId)))
    .limit(1);

  if (!appr) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  if (appr.status !== 'pending') return NextResponse.json({ error: 'This request has already been decided.' }, { status: 409 });
  if (appr.requestedByMemberId && session.memberId && appr.requestedByMemberId === session.memberId) {
    return NextResponse.json({ error: 'You cannot approve your own request.' }, { status: 403 });
  }

  if (body.decision === 'approve') {
    await applyApproval(appr.action, appr.lpId, appr.payload);
  }

  await db
    .update(lpApprovals)
    .set({
      status: body.decision === 'approve' ? 'approved' : 'rejected',
      decidedByMemberId: session.memberId ?? null,
      decidedAt: new Date(),
    })
    .where(eq(lpApprovals.id, body.approvalId));

  return NextResponse.json({ ok: true });
}
