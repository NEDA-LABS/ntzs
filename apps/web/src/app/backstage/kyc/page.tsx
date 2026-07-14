import { and, desc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { requireAnyRole, getCurrentDbUser } from '@/lib/auth/rbac'
import { SubmitButton } from '../_components/SubmitButton'
import { getDb } from '@/lib/db'
import { users, kycCases, partnerUsers, partners } from '@ntzs/db'
import { writeAuditLog } from '@/lib/audit'
import { formatDateEAT } from '@/lib/format-date'
import { kycDisplayName } from '@/lib/kyc/display'

async function updateKycStatusAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin', 'platform_compliance'])
  const currentUser = await getCurrentDbUser()
  if (!currentUser) throw new Error('User not found')

  const kycCaseId = String(formData.get('kycCaseId') ?? '')
  const status = String(formData.get('status') ?? '') as 'approved' | 'rejected'
  const reason = String(formData.get('reason') ?? '').trim()

  if (!kycCaseId || !['approved', 'rejected'].includes(status)) {
    throw new Error('Invalid parameters')
  }
  // A rejection without a reason is unauditable — the user needs to know what
  // to fix and the BoT file needs the why.
  if (status === 'rejected' && !reason) {
    throw new Error('A reason is required to reject a KYC case')
  }

  const { db } = getDb()

  const [existing] = await db
    .select({ status: kycCases.status, reviewReason: kycCases.reviewReason })
    .from(kycCases)
    .where(eq(kycCases.id, kycCaseId))
    .limit(1)
  if (!existing) throw new Error('KYC case not found')

  // Preserve the ladder's collected evidence — the review decision appends to
  // it rather than overwriting the audit trail.
  const combinedReason = reason
    ? `${existing.reviewReason ? `${existing.reviewReason} · ` : ''}Review: ${reason}`
    : existing.reviewReason

  // Only pending cases are reviewable (claim-style condition — a decided case
  // can never be flipped by a second click or a stale tab).
  const updated = await db
    .update(kycCases)
    .set({
      status,
      reviewedByUserId: currentUser.id,
      reviewedAt: new Date(),
      reviewReason: combinedReason,
      updatedAt: new Date(),
    })
    .where(and(eq(kycCases.id, kycCaseId), eq(kycCases.status, 'pending')))
    .returning({ id: kycCases.id })
  if (updated.length === 0) {
    throw new Error('Only pending cases can be reviewed (this one may have just been decided)')
  }

  await writeAuditLog(`kyc.${status}`, 'kyc_case', kycCaseId, { reason: reason || null }, currentUser.id)

  revalidatePath('/backstage/kyc')
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    rejected: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status] || styles.pending}`}>
      {status}
    </span>
  )
}

export default async function KycPage() {
  const { db } = getDb()

  // Real totals across the whole table — the list below is windowed, the
  // numbers here must not be. verifiedIdentities counts distinct PEOPLE with
  // an approved case: the number that counts toward the 100-participant pilot.
  const [counts] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${kycCases.status} = 'pending')`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${kycCases.status} = 'rejected')`.mapWith(Number),
      verifiedIdentities: sql<number>`count(distinct ${kycCases.userId}) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
    })
    .from(kycCases)

  // Most recent attempts with the person + issuance source attached. Grouped
  // below to one row per person (latest case wins, attempts counted) so a
  // user who retried eight times is one line, not eight.
  const recent = await db
    .select({
      id: kycCases.id,
      userId: kycCases.userId,
      nationalId: kycCases.nationalId,
      status: kycCases.status,
      provider: kycCases.provider,
      reviewReason: kycCases.reviewReason,
      createdAt: kycCases.createdAt,
      reviewedAt: kycCases.reviewedAt,
      userEmail: users.email,
      userName: users.name,
      partnerName: partners.name,
    })
    .from(kycCases)
    .innerJoin(users, eq(kycCases.userId, users.id))
    .leftJoin(partnerUsers, eq(partnerUsers.userId, kycCases.userId))
    .leftJoin(partners, eq(partners.id, partnerUsers.partnerId))
    .orderBy(desc(kycCases.createdAt))
    .limit(500)

  const byUser = new Map<
    string,
    { row: (typeof recent)[number]; caseIds: Set<string>; sources: Set<string> }
  >()
  for (const r of recent) {
    const group = byUser.get(r.userId) ?? { row: r, caseIds: new Set<string>(), sources: new Set<string>() }
    group.caseIds.add(r.id)
    group.sources.add(r.partnerName ?? 'Direct app')
    byUser.set(r.userId, group)
  }
  const rows = [...byUser.values()].map((g) => ({
    ...g.row,
    attempts: g.caseIds.size,
    source: [...g.sources].join(' · '),
    displayName: kycDisplayName({ reviewReason: g.row.reviewReason, declaredName: g.row.userName, email: g.row.userEmail }),
  }))

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-bold text-white">KYC Verification</h1>
          <p className="mt-1 text-sm text-zinc-400">
            One row per person (latest case, attempts counted) · verified NIDA names · issuance source
          </p>
        </div>
      </div>

      <div className="p-8">
        {/* Stats */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-white">{counts?.total ?? 0}</p>
            <p className="text-sm text-zinc-500">Total Attempts</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-2xl font-bold text-amber-400">{counts?.pending ?? 0}</p>
            <p className="text-sm text-zinc-500">Pending Review</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="text-2xl font-bold text-emerald-400">{counts?.approved ?? 0}</p>
            <p className="text-sm text-zinc-500">Approved Cases</p>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-2xl font-bold text-emerald-300">{counts?.verifiedIdentities ?? 0}</p>
            <p className="text-sm text-zinc-500">Verified Identities <span className="text-zinc-600">· pilot counts these</span></p>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
            <p className="text-2xl font-bold text-rose-400">{counts?.rejected ?? 0}</p>
            <p className="text-sm text-zinc-500">Rejected</p>
          </div>
        </div>

        {/* KYC Cases Table */}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-900/80">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-4">Person</th>
                  <th className="px-6 py-4">National ID</th>
                  <th className="px-6 py-4">Source</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Attempts</th>
                  <th className="px-6 py-4">Latest</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <p className="text-zinc-500">No KYC submissions yet</p>
                    </td>
                  </tr>
                ) : (
                  rows.map((kyc) => (
                    <tr key={kyc.userId} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-white">{kyc.displayName}</div>
                        <div className="text-xs text-zinc-500">{kyc.userEmail}</div>
                      </td>
                      <td className="px-6 py-4">
                        <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300">
                          {kyc.nationalId}
                        </code>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                            kyc.source === 'Direct app'
                              ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                              : 'border-violet-500/30 bg-violet-500/15 text-violet-300'
                          }`}
                          title="Where this user's wallet was issued"
                        >
                          {kyc.source}
                        </span>
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-600">{kyc.provider}</div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={kyc.status} />
                        {kyc.reviewReason && (
                          <p className="mt-1 max-w-[280px] truncate text-xs text-zinc-600" title={kyc.reviewReason}>
                            {kyc.reviewReason}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-400">
                        {kyc.attempts > 1 ? `${kyc.attempts}×` : '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-400">
                        {formatDateEAT(kyc.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        {kyc.status === 'pending' ? (
                          <div className="flex flex-col gap-1.5">
                            <form action={updateKycStatusAction}>
                              <input type="hidden" name="kycCaseId" value={kyc.id} />
                              <input type="hidden" name="status" value="approved" />
                              <SubmitButton
                                pendingText="Approving..."
                                className="rounded-lg bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20"
                              >
                                Approve
                              </SubmitButton>
                            </form>
                            <form action={updateKycStatusAction} className="flex items-center gap-1.5">
                              <input type="hidden" name="kycCaseId" value={kyc.id} />
                              <input type="hidden" name="status" value="rejected" />
                              <input
                                type="text"
                                name="reason"
                                placeholder="Rejection reason (required)"
                                className="w-40 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-rose-500/50"
                              />
                              <SubmitButton
                                pendingText="Rejecting..."
                                className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/20"
                              >
                                Reject
                              </SubmitButton>
                            </form>
                          </div>
                        ) : (
                          <span className="text-sm text-zinc-600">
                            {kyc.reviewedAt ? `Reviewed ${formatDateEAT(kyc.reviewedAt)}` : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/5 px-6 py-3 text-xs text-zinc-600">
            Latest case per person from the most recent 500 attempts. Evidence trail on hover; full history in the database.
          </div>
        </div>
      </div>
    </div>
  )
}
