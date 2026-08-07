import { NextRequest, NextResponse } from 'next/server'
import { and, eq, ne } from 'drizzle-orm'

import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpAccounts, lpMembers } from '@ntzs/db'

// role undefined = legacy session = treat as owner (back-compat until re-login).
const isOwner = (role: string | undefined) => !role || role === 'owner'

/**
 * The org's value ceiling for maker-checker.
 *
 * Also reports whether a SECOND approver exists: a checker may not approve
 * their own request, so a ceiling on a single-member account would park every
 * large action with nobody able to release it. The UI warns on that rather
 * than letting an owner lock their own funds away.
 */
export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [lp] = await db
    .select({
      approvalThresholdTzs: lpAccounts.approvalThresholdTzs,
      approvalThresholdUsd: lpAccounts.approvalThresholdUsd,
    })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, session.lpId))
    .limit(1)

  const otherCheckers = await db
    .select({ id: lpMembers.id, email: lpMembers.email, role: lpMembers.role, status: lpMembers.status })
    .from(lpMembers)
    .where(and(eq(lpMembers.lpId, session.lpId), ne(lpMembers.role, 'viewer'), ne(lpMembers.role, 'operator')))

  const canApproveOthers = otherCheckers.filter((m) => m.id !== session.memberId && m.status !== 'disabled')

  return NextResponse.json({
    thresholdTzs: lp?.approvalThresholdTzs ?? null,
    thresholdUsd: lp?.approvalThresholdUsd ?? null,
    secondApproverCount: canApproveOthers.length,
    canEdit: isOwner(session.role),
  })
}

/**
 * PATCH — set or clear a ceiling. Owner only.
 * Body: { thresholdTzs?: number|null, thresholdUsd?: number|null } — an omitted
 * key is left alone, so the two ceilings can be saved independently.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(session.role)) {
    return NextResponse.json({ error: 'Only the account owner can change the approval threshold.' }, { status: 403 })
  }

  let body: { thresholdTzs?: number | null; thresholdUsd?: number | null }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // null/0/'' clears the ceiling; anything else must be a positive whole amount.
  const parse = (raw: number | null | undefined): number | null | 'invalid' => {
    if (raw === null || raw === undefined || raw === 0 || (raw as unknown) === '') return null
    const n = Math.trunc(Number(raw))
    return Number.isFinite(n) && n > 0 ? n : 'invalid'
  }

  const patch: { approvalThresholdTzs?: number | null; approvalThresholdUsd?: number | null; updatedAt: Date } = {
    updatedAt: new Date(),
  }

  if ('thresholdTzs' in body) {
    const v = parse(body.thresholdTzs)
    if (v === 'invalid') {
      return NextResponse.json({ error: 'Threshold must be a positive amount, or blank to remove it.' }, { status: 400 })
    }
    patch.approvalThresholdTzs = v
  }
  if ('thresholdUsd' in body) {
    const v = parse(body.thresholdUsd)
    if (v === 'invalid') {
      return NextResponse.json({ error: 'Threshold must be a positive amount, or blank to remove it.' }, { status: 400 })
    }
    patch.approvalThresholdUsd = v
  }

  await db.update(lpAccounts).set(patch).where(eq(lpAccounts.id, session.lpId))

  const [after] = await db
    .select({
      thresholdTzs: lpAccounts.approvalThresholdTzs,
      thresholdUsd: lpAccounts.approvalThresholdUsd,
    })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, session.lpId))
    .limit(1)

  return NextResponse.json({ ok: true, ...after })
}
