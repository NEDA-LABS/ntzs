import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { requireAnyRole, getCurrentDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { users, kycCases } from '@ntzs/db'
import { writeAuditLog } from '@/lib/audit'
import { formatDateEAT } from '@/lib/format-date'

async function updateKycStatusAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin', 'platform_compliance'])
  const currentUser = await getCurrentDbUser()
  if (!currentUser) throw new Error('User not found')

  const kycCaseId = String(formData.get('kycCaseId') ?? '')
  const status = String(formData.get('status') ?? '') as 'approved' | 'rejected'
  const reason = String(formData.get('reason') ?? '')

  if (!kycCaseId || !['approved', 'rejected'].includes(status)) {
    throw new Error('Invalid parameters')
  }

  const { db } = getDb()

  await db
    .update(kycCases)
    .set({
      status,
      reviewedByUserId: currentUser.id,
      reviewedAt: new Date(),
      reviewReason: reason || null,
      updatedAt: new Date(),
    })
    .where(eq(kycCases.id, kycCaseId))

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

  // Fetch all KYC cases with user info
  const allKycCases = await db
    .select({
      id: kycCases.id,
      nationalId: kycCases.nationalId,
      status: kycCases.status,
      provider: kycCases.provider,
      reviewReason: kycCases.reviewReason,
      createdAt: kycCases.createdAt,
      reviewedAt: kycCases.reviewedAt,
      userEmail: users.email,
      userId: users.id,
    })
    .from(kycCases)
    .innerJoin(users, eq(kycCases.userId, users.id))
    .orderBy(desc(kycCases.createdAt))
    .limit(200)

  const pendingCount = allKycCases.filter(k => k.status === 'pending').length
  const approvedCount = allKycCases.filter(k => k.status === 'approved').length
  const rejectedCount = allKycCases.filter(k => k.status === 'rejected').length

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-bold text-white">KYC Verification</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Review and approve user identity verification submissions
          </p>
        </div>
      </div>

      <div className="p-8">
        {/* Stats */}
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-white">{allKycCases.length}</p>
            <p className="text-sm text-zinc-500">Total Submissions</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-2xl font-bold text-amber-400">{pendingCount}</p>
            <p className="text-sm text-zinc-500">Pending Review</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="text-2xl font-bold text-emerald-400">{approvedCount}</p>
            <p className="text-sm text-zinc-500">Approved</p>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
            <p className="text-2xl font-bold text-rose-400">{rejectedCount}</p>
            <p className="text-sm text-zinc-500">Rejected</p>
          </div>
        </div>

        {/* KYC Cases Table */}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-900/80">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">National ID</th>
                  <th className="px-6 py-4">Provider</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Submitted</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {allKycCases.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <svg className="mx-auto h-12 w-12 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                      </svg>
                      <p className="mt-4 text-zinc-500">No KYC submissions yet</p>
                    </td>
                  </tr>
                ) : (
                  allKycCases.map((kyc) => (
                    <tr key={kyc.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-white">{kyc.userEmail}</div>
                      </td>
                      <td className="px-6 py-4">
                        <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300">
                          {kyc.nationalId}
                        </code>
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-400">{kyc.provider}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={kyc.status} />
                        {kyc.reviewReason && (
                          <p className="mt-1 text-xs text-zinc-600">{kyc.reviewReason}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-400">
                        {formatDateEAT(kyc.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        {kyc.status === 'pending' ? (
                          <div className="flex gap-2">
                            <form action={updateKycStatusAction}>
                              <input type="hidden" name="kycCaseId" value={kyc.id} />
                              <input type="hidden" name="status" value="approved" />
                              <button
                                type="submit"
                                className="rounded-lg bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                              >
                                Approve
                              </button>
                            </form>
                            <form action={updateKycStatusAction}>
                              <input type="hidden" name="kycCaseId" value={kyc.id} />
                              <input type="hidden" name="status" value="rejected" />
                              <button
                                type="submit"
                                className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/20 transition-colors"
                              >
                                Reject
                              </button>
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
        </div>
      </div>
    </div>
  )
}
