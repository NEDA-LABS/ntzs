import { desc, eq, count, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { ethers } from 'ethers'

import { requireRole, requireAnyRole } from '@/lib/auth/rbac'
import { SubmitButton } from '../_components/SubmitButton'
import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { partners, partnerUsers, depositRequests, burnRequests, partnerKyb } from '@ntzs/db'
import { writeAuditLog } from '@/lib/audit'
import { formatDateEAT } from '@/lib/format-date'

async function togglePartnerStatusAction(formData: FormData) {
  'use server'
  await requireRole('super_admin')

  const partnerId = String(formData.get('partnerId') ?? '')
  const action = String(formData.get('action') ?? '') as 'suspend' | 'reactivate'
  const reason = String(formData.get('reason') ?? '').trim()

  if (!partnerId) throw new Error('Missing partnerId')

  const { db } = getDb()

  if (action === 'suspend') {
    await db
      .update(partners)
      .set({ suspendedAt: new Date(), suspendReason: reason || 'Suspended by admin', isActive: false, updatedAt: new Date() })
      .where(eq(partners.id, partnerId))
    await writeAuditLog('partner.suspended', 'partner', partnerId, { reason: reason || 'Suspended by admin' })
  } else {
    await db
      .update(partners)
      .set({ suspendedAt: null, suspendReason: null, isActive: true, updatedAt: new Date() })
      .where(eq(partners.id, partnerId))
    await writeAuditLog('partner.reactivated', 'partner', partnerId, {})
  }

  revalidatePath('/backstage/partners')
}

async function updateDailyLimitAction(formData: FormData) {
  'use server'
  await requireRole('super_admin')

  const partnerId = String(formData.get('partnerId') ?? '')
  const dailyLimitTzs = Number(formData.get('dailyLimitTzs') ?? 0)

  if (!partnerId) throw new Error('Missing partnerId')

  const { db } = getDb()

  await db
    .update(partners)
    .set({ dailyLimitTzs: dailyLimitTzs > 0 ? dailyLimitTzs : null, updatedAt: new Date() })
    .where(eq(partners.id, partnerId))

  await writeAuditLog('partner.limit_updated', 'partner', partnerId, { dailyLimitTzs })
  revalidatePath('/backstage/partners')
}

async function reviewKybAction(formData: FormData) {
  'use server'
  const reviewer = await requireAnyRole(['super_admin', 'platform_compliance'])

  const partnerId = String(formData.get('partnerId') ?? '')
  const decision = String(formData.get('decision') ?? '') as 'approved' | 'rejected'
  const notes = String(formData.get('notes') ?? '').trim()

  if (!partnerId || !['approved', 'rejected'].includes(decision)) throw new Error('Invalid input')

  const { db } = getDb()
  const now = new Date()

  await db
    .update(partnerKyb)
    .set({
      status: decision,
      reviewNotes: notes || null,
      reviewedAt: now,
      reviewedBy: reviewer.email,
      updatedAt: now,
    })
    .where(eq(partnerKyb.partnerId, partnerId))

  await writeAuditLog(`partner.kyb.${decision}`, 'partner', partnerId, { notes, reviewedBy: reviewer.email })
  revalidatePath('/backstage/partners')
}

export default async function PartnersPage() {
  await requireRole('super_admin')
  const { db } = getDb()

  const allPartners = await db
    .select({
      id: partners.id,
      name: partners.name,
      email: partners.email,
      isActive: partners.isActive,
      suspendedAt: partners.suspendedAt,
      suspendReason: partners.suspendReason,
      dailyLimitTzs: partners.dailyLimitTzs,
      contractSignedAt: partners.contractSignedAt,
      apiKeyPrefix: partners.apiKeyPrefix,
      nextWalletIndex: partners.nextWalletIndex,
      treasuryWalletAddress: partners.treasuryWalletAddress,
      feePercent: partners.feePercent,
      createdAt: partners.createdAt,
    })
    .from(partners)
    .orderBy(desc(partners.createdAt))

  // Fetch on-chain treasury balances (best-effort)
  const rpcUrl = BASE_RPC_URL
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
  const treasuryBalances: Record<string, number> = {}

  if (rpcUrl && contractAddress) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const token = new ethers.Contract(
        contractAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      )
      await Promise.all(
        allPartners
          .filter(p => p.treasuryWalletAddress)
          .map(async (p) => {
            try {
              const bal: bigint = await token.balanceOf(p.treasuryWalletAddress!)
              treasuryBalances[p.id] = Number(bal / BigInt(10) ** BigInt(18))
            } catch {
              treasuryBalances[p.id] = 0
            }
          })
      )
    } catch {
      // RPC unavailable, all balances stay 0
    }
  }

  const partnerStats = await db
    .select({
      partnerId: partnerUsers.partnerId,
      userCount: count(partnerUsers.id),
    })
    .from(partnerUsers)
    .groupBy(partnerUsers.partnerId)

  const depositVolumes = await db
    .select({
      partnerId: depositRequests.partnerId,
      totalMinted: sql<number>`coalesce(sum(case when ${depositRequests.status} = 'minted' then ${depositRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
      depositCount: count(depositRequests.id),
    })
    .from(depositRequests)
    .where(sql`${depositRequests.partnerId} is not null`)
    .groupBy(depositRequests.partnerId)

  const burnVolumes = await db
    .select({
      userId: burnRequests.userId,
      totalBurned: sql<number>`coalesce(sum(case when ${burnRequests.status} = 'burned' then ${burnRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
    })
    .from(burnRequests)
    .groupBy(burnRequests.userId)

  // KYB records that need attention
  const kybRecords = await db
    .select({
      id: partnerKyb.id,
      partnerId: partnerKyb.partnerId,
      status: partnerKyb.status,
      businessLegalName: partnerKyb.businessLegalName,
      registrationNumber: partnerKyb.registrationNumber,
      registeredAddress: partnerKyb.registeredAddress,
      authorizedRepName: partnerKyb.authorizedRepName,
      authorizedRepTitle: partnerKyb.authorizedRepTitle,
      authorizedRepEmail: partnerKyb.authorizedRepEmail,
      licenseType: partnerKyb.licenseType,
      licenseNumber: partnerKyb.licenseNumber,
      issuingAuthority: partnerKyb.issuingAuthority,
      jurisdiction: partnerKyb.jurisdiction,
      certOfIncorporationUrl: partnerKyb.certOfIncorporationUrl,
      regulatoryLicenseUrl: partnerKyb.regulatoryLicenseUrl,
      amlPolicyUrl: partnerKyb.amlPolicyUrl,
      reviewNotes: partnerKyb.reviewNotes,
      reviewedAt: partnerKyb.reviewedAt,
      reviewedBy: partnerKyb.reviewedBy,
      submittedAt: partnerKyb.submittedAt,
    })
    .from(partnerKyb)
    .orderBy(desc(partnerKyb.submittedAt))

  const partnerNameMap = new Map(allPartners.map(p => [p.id, p.name]))

  const statsMap = new Map(partnerStats.map(s => [s.partnerId, s.userCount]))
  const depositMap = new Map(depositVolumes.map(d => [d.partnerId, d]))

  const activeCount = allPartners.filter(p => p.isActive).length
  const suspendedCount = allPartners.filter(p => !p.isActive).length
  const totalUsers = partnerStats.reduce((sum, s) => sum + s.userCount, 0)
  const totalVolume = depositVolumes.reduce((sum, d) => sum + d.totalMinted, 0)

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Partner Management</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Manage WaaS partners, their limits, and compliance status
          </p>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-white">{allPartners.length}</p>
            <p className="text-sm text-zinc-500">Total Partners</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="text-2xl font-bold text-emerald-400">{activeCount}</p>
            <p className="text-sm text-zinc-500">Active</p>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
            <p className="text-2xl font-bold text-rose-400">{suspendedCount}</p>
            <p className="text-sm text-zinc-500">Suspended</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-violet-400">{totalUsers.toLocaleString()}</p>
            <p className="text-sm text-zinc-500">WaaS Users</p>
          </div>
        </div>

        {/* Partners Table */}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
          <div className="border-b border-white/10 px-6 py-4">
            <h2 className="text-lg font-semibold text-white">All Partners</h2>
            <p className="text-sm text-zinc-500">Total minted across all partners: {totalVolume.toLocaleString()} TZS</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-900/80">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-4">Partner</th>
                  <th className="px-6 py-4">API Key</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Users</th>
                  <th className="px-6 py-4">Volume Minted</th>
                  <th className="px-6 py-4">Fee %</th>
                  <th className="px-6 py-4">Treasury</th>
                  <th className="px-6 py-4">Daily Limit</th>
                  <th className="px-6 py-4">Contract</th>
                  <th className="px-6 py-4">Joined</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {allPartners.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-sm text-zinc-500">
                      No partners yet. Partners are created via the WaaS API.
                    </td>
                  </tr>
                ) : (
                  allPartners.map((partner) => {
                    const stats = depositMap.get(partner.id)
                    const userCount = statsMap.get(partner.id) ?? 0
                    const treasuryBalance = treasuryBalances[partner.id] ?? 0
                    const feePercent = parseFloat(String(partner.feePercent ?? '0'))
                    return (
                      <tr key={partner.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-medium text-white">{partner.name}</div>
                          <div className="mt-0.5 text-xs text-zinc-500">{partner.email || '—'}</div>
                          <div className="mt-0.5 font-mono text-xs text-zinc-700">{partner.id.slice(0, 8)}...</div>
                        </td>
                        <td className="px-6 py-4">
                          <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300">
                            {partner.apiKeyPrefix || '—'}...
                          </code>
                        </td>
                        <td className="px-6 py-4">
                          {partner.isActive ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Active
                            </span>
                          ) : (
                            <div>
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                                Suspended
                              </span>
                              {partner.suspendReason && (
                                <p className="mt-0.5 text-xs text-zinc-600">{partner.suspendReason}</p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-white font-semibold">
                          {userCount.toLocaleString()}
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-sm text-emerald-400">
                            {(stats?.totalMinted ?? 0).toLocaleString()} TZS
                          </span>
                          {stats?.depositCount ? (
                            <p className="text-xs text-zinc-600">{stats.depositCount} deposits</p>
                          ) : null}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`font-mono text-sm font-semibold ${
                            feePercent > 0 ? 'text-violet-400' : 'text-zinc-600'
                          }`}>
                            {feePercent > 0 ? `${feePercent}%` : '—'}
                          </span>
                          {feePercent > 0 && (
                            <p className="text-xs text-zinc-600">auto-split</p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {partner.treasuryWalletAddress ? (
                            <div>
                              <span className={`font-mono text-sm font-semibold ${
                                treasuryBalance > 0 ? 'text-emerald-400' : 'text-zinc-500'
                              }`}>
                                {treasuryBalance.toLocaleString()} TZS
                              </span>
                              <p className="mt-0.5 font-mono text-xs text-zinc-700" title={partner.treasuryWalletAddress}>
                                {partner.treasuryWalletAddress.slice(0, 10)}...
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-amber-500/70">Not provisioned</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <form action={updateDailyLimitAction} className="flex items-center gap-2">
                            <input type="hidden" name="partnerId" value={partner.id} />
                            <input
                              type="number"
                              name="dailyLimitTzs"
                              defaultValue={partner.dailyLimitTzs ?? ''}
                              placeholder="No limit"
                              className="w-28 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-violet-500/50 focus:outline-none"
                            />
                            <SubmitButton
                              pendingText="Setting..."
                              className="rounded-lg bg-zinc-700 px-2.5 py-1.5 text-xs text-white hover:bg-zinc-600"
                            >
                              Set
                            </SubmitButton>
                          </form>
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-400">
                          {partner.contractSignedAt
                            ? formatDateEAT(partner.contractSignedAt)
                            : <span className="text-amber-500/80">Not signed</span>}
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-400">
                          {formatDateEAT(partner.createdAt)}
                        </td>
                        <td className="px-6 py-4">
                          {partner.isActive ? (
                            <form action={togglePartnerStatusAction} className="flex items-center gap-2">
                              <input type="hidden" name="partnerId" value={partner.id} />
                              <input type="hidden" name="action" value="suspend" />
                              <input
                                type="text"
                                name="reason"
                                placeholder="Reason (optional)"
                                className="w-36 rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white focus:border-rose-500/50 focus:outline-none"
                              />
                              <SubmitButton
                                pendingText="Suspending..."
                                className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20"
                              >
                                Suspend
                              </SubmitButton>
                            </form>
                          ) : (
                            <form action={togglePartnerStatusAction}>
                              <input type="hidden" name="partnerId" value={partner.id} />
                              <input type="hidden" name="action" value="reactivate" />
                              <SubmitButton
                                pendingText="Reactivating..."
                                className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20"
                              >
                                Reactivate
                              </SubmitButton>
                            </form>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* KYB Review */}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
          <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">KYB Reviews</h2>
              <p className="text-sm text-zinc-500">Partner Know-Your-Business submissions</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-400" /> Submitted
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-yellow-400" /> Under review
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Approved
              </span>
            </div>
          </div>

          {kybRecords.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-zinc-500">No KYB submissions yet</p>
          ) : (
            <div className="divide-y divide-white/5">
              {kybRecords.map((kyb) => {
                const partnerName = partnerNameMap.get(kyb.partnerId) ?? kyb.partnerId.slice(0, 8)
                const isActionable = kyb.status === 'submitted' || kyb.status === 'under_review'
                const statusColors: Record<string, string> = {
                  not_started: 'bg-zinc-700 text-zinc-400',
                  submitted: 'bg-blue-500/20 text-blue-300',
                  under_review: 'bg-yellow-500/20 text-yellow-300',
                  approved: 'bg-emerald-500/20 text-emerald-300',
                  rejected: 'bg-rose-500/20 text-rose-300',
                }
                return (
                  <div key={kyb.id} className="px-6 py-5 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{partnerName}</span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusColors[kyb.status] ?? statusColors.not_started}`}>
                            {kyb.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        {kyb.submittedAt && (
                          <p className="mt-0.5 text-xs text-zinc-500">Submitted {formatDateEAT(kyb.submittedAt)}</p>
                        )}
                        {kyb.reviewedBy && (
                          <p className="mt-0.5 text-xs text-zinc-600">
                            Reviewed by {kyb.reviewedBy}{kyb.reviewedAt ? ` on ${formatDateEAT(kyb.reviewedAt)}` : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Business details */}
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-4">
                      {[
                        ['Legal name', kyb.businessLegalName],
                        ['Reg. number', kyb.registrationNumber],
                        ['Rep name', kyb.authorizedRepName],
                        ['Rep title', kyb.authorizedRepTitle],
                        ['Rep email', kyb.authorizedRepEmail],
                        ['License type', kyb.licenseType],
                        ['License no.', kyb.licenseNumber],
                        ['Authority', kyb.issuingAuthority],
                        ['Jurisdiction', kyb.jurisdiction],
                      ].map(([label, value]) => value ? (
                        <div key={label}>
                          <span className="text-zinc-500">{label}: </span>
                          <span className="text-zinc-200">{value}</span>
                        </div>
                      ) : null)}
                    </div>
                    {kyb.registeredAddress && (
                      <p className="text-xs text-zinc-400"><span className="text-zinc-500">Address: </span>{kyb.registeredAddress}</p>
                    )}

                    {/* Documents */}
                    <div className="flex flex-wrap gap-2">
                      {!kyb.certOfIncorporationUrl && !kyb.regulatoryLicenseUrl && !kyb.amlPolicyUrl && (
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400">
                          ⚠ No documents uploaded — the partner must upload the Certificate of
                          Incorporation before this can be approved
                        </span>
                      )}
                      {kyb.certOfIncorporationUrl && (
                        <a href={kyb.certOfIncorporationUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:text-white">
                          📄 Certificate of Incorporation
                        </a>
                      )}
                      {kyb.regulatoryLicenseUrl && (
                        <a href={kyb.regulatoryLicenseUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:text-white">
                          📄 Regulatory License
                        </a>
                      )}
                      {kyb.amlPolicyUrl && (
                        <a href={kyb.amlPolicyUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:text-white">
                          📄 AML / CFT Policy
                        </a>
                      )}
                    </div>

                    {/* Review notes (existing) */}
                    {kyb.reviewNotes && (
                      <p className="rounded-lg border border-white/10 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-300">
                        <span className="font-medium text-zinc-400">Notes: </span>{kyb.reviewNotes}
                      </p>
                    )}

                    {/* Approve / Reject forms */}
                    {isActionable && (
                      <div className="flex flex-wrap items-end gap-3 pt-1">
                        <form action={reviewKybAction} className="flex items-center gap-2">
                          <input type="hidden" name="partnerId" value={kyb.partnerId} />
                          <input type="hidden" name="decision" value="approved" />
                          <input
                            type="text"
                            name="notes"
                            placeholder="Notes (optional)"
                            className="w-52 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500/50 focus:outline-none"
                          />
                          <SubmitButton
                            pendingText="Approving…"
                            className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20"
                          >
                            Approve
                          </SubmitButton>
                        </form>
                        <form action={reviewKybAction} className="flex items-center gap-2">
                          <input type="hidden" name="partnerId" value={kyb.partnerId} />
                          <input type="hidden" name="decision" value="rejected" />
                          <input
                            type="text"
                            name="notes"
                            placeholder="Rejection reason"
                            className="w-52 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-rose-500/50 focus:outline-none"
                          />
                          <SubmitButton
                            pendingText="Rejecting…"
                            className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20"
                          >
                            Reject
                          </SubmitButton>
                        </form>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Info box */}
        <div className="rounded-xl border border-white/10 bg-zinc-900/30 p-5">
          <h3 className="text-sm font-semibold text-zinc-300">Creating New Partners</h3>
          <p className="mt-2 text-sm text-zinc-500">
            New partners are onboarded via the WaaS API:
          </p>
          <code className="mt-2 block rounded-lg bg-black/50 p-3 font-mono text-xs text-zinc-300">
            POST /api/v1/partners/signup
          </code>
          <p className="mt-2 text-xs text-zinc-600">
            Body: <code className="text-zinc-500">{'{ "businessName": "...", "email": "...", "password": "...", "webhookUrl": "..." }'}</code>
          </p>
        </div>
      </div>
    </div>
  )
}
