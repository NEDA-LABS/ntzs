import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts, lpMembers } from '@ntzs/db';
import { sendFxMail, fxEmailShell } from '@/lib/fx/mailer';

const INVITABLE_ROLES = ['operator', 'approver', 'viewer'] as const;
type InvitableRole = typeof INVITABLE_ROLES[number];

// role undefined = legacy session = treat as owner (back-compat until re-login).
const isOwner = (role: string | undefined) => !role || role === 'owner';

/** GET /api/lp/members — list the org's members. */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const members = await db
    .select({
      id: lpMembers.id,
      email: lpMembers.email,
      role: lpMembers.role,
      status: lpMembers.status,
      createdAt: lpMembers.createdAt,
    })
    .from(lpMembers)
    .where(eq(lpMembers.lpId, session.lpId));

  return NextResponse.json({ members, you: { memberId: session.memberId ?? null, role: session.role ?? 'owner' } });
}

/** POST /api/lp/members — invite a teammate. Owner only. Body: { email, role }. */
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwner(session.role)) return NextResponse.json({ error: 'Only the account owner can invite members.' }, { status: 403 });

  let body: { email?: string; role?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const email = body.email?.toLowerCase().trim();
  const role = body.role as InvitableRole;
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  if (!INVITABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Role must be operator, approver, or viewer.' }, { status: 400 });
  }

  // An email belongs to exactly one member globally.
  const [existing] = await db.select({ id: lpMembers.id, lpId: lpMembers.lpId }).from(lpMembers).where(eq(lpMembers.email, email)).limit(1);
  if (existing) {
    return NextResponse.json(
      { error: existing.lpId === session.lpId ? 'That email is already on your team.' : 'That email already belongs to another account.' },
      { status: 409 },
    );
  }

  const [member] = await db
    .insert(lpMembers)
    .values({ lpId: session.lpId, email, role, status: 'invited', invitedByMemberId: session.memberId ?? null })
    .returning({ id: lpMembers.id, email: lpMembers.email, role: lpMembers.role, status: lpMembers.status, createdAt: lpMembers.createdAt });

  // Notify the invitee (best-effort).
  const [org] = await db.select({ displayName: lpAccounts.displayName }).from(lpAccounts).where(eq(lpAccounts.id, session.lpId)).limit(1);
  const orgName = org?.displayName?.trim() || 'a SimpleFX liquidity partner';
  sendFxMail(
    email,
    `You've been invited to ${orgName} on SimpleFX`,
    fxEmailShell('You’ve been invited', `
      <p style="font-size:14px;line-height:1.6;color:#334155">You’ve been added to <b>${orgName}</b> on SimpleFX as <b>${role}</b>.</p>
      <p style="font-size:14px;line-height:1.6;color:#334155">Sign in with this email to accept — your access is set up automatically on first sign-in.</p>
      <p><a href="https://www.ntzs.co.tz/simplefx" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Sign in to SimpleFX</a></p>
    `),
  ).catch((e) => console.error('[members invite email]', e));

  return NextResponse.json({ ok: true, member });
}

/** DELETE /api/lp/members — remove (disable) a member. Owner only. Body: { memberId }. */
export async function DELETE(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwner(session.role)) return NextResponse.json({ error: 'Only the account owner can remove members.' }, { status: 403 });

  let body: { memberId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.memberId) return NextResponse.json({ error: 'memberId is required.' }, { status: 400 });

  const [target] = await db.select({ role: lpMembers.role }).from(lpMembers)
    .where(and(eq(lpMembers.id, body.memberId), eq(lpMembers.lpId, session.lpId))).limit(1);
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
  if (target.role === 'owner') return NextResponse.json({ error: 'The owner cannot be removed.' }, { status: 400 });

  await db.update(lpMembers).set({ status: 'disabled', updatedAt: new Date() })
    .where(and(eq(lpMembers.id, body.memberId), eq(lpMembers.lpId, session.lpId)));

  return NextResponse.json({ ok: true });
}
