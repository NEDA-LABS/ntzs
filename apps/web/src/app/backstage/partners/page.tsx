import { desc, eq, count, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { requireRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { partners, partnerUsers, depositRequests, burnRequests } from '@ntzs/db'
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
      createdAt: partners.createdAt,
    })
    .from(partners)
    .orderBy(desc(partners.createdAt))

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
                  <th className="px-6 py-4">Daily Limit</th>
                  <th className="px-6 py-4">Contract</th>
                  <th className="px-6 py-4">Joined</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {allPartners.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-sm text-zinc-500">
                      No partners yet. Partners are created via the WaaS API.
                    </td>
                  </tr>
                ) : (
                  allPartners.map((partner) => {
                    const stats = depositMap.get(partner.id)
                    const userCount = statsMap.get(partner.id) ?? 0
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
                          <form action={updateDailyLimitAction} className="flex items-center gap-2">
                            <input type="hidden" name="partnerId" value={partner.id} />
                            <input
                              type="number"
                              name="dailyLimitTzs"
                              defaultValue={partner.dailyLimitTzs ?? ''}
                              placeholder="No limit"
                              className="w-28 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-violet-500/50 focus:outline-none"
                            />
                            <button
                              type="submit"
                              className="rounded-lg bg-zinc-700 px-2.5 py-1.5 text-xs text-white hover:bg-zinc-600 transition-colors"
                            >
                              Set
                            </button>
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
                              <button
                                type="submit"
                                className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 transition-colors"
                              >
                                Suspend
                              </button>
                            </form>
                          ) : (
                            <form action={togglePartnerStatusAction}>
                              <input type="hidden" name="partnerId" value={partner.id} />
                              <input type="hidden" name="action" value="reactivate" />
                              <button
                                type="submit"
                                className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                              >
                                Reactivate
                              </button>
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
