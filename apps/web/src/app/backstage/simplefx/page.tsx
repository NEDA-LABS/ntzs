import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { lpAccounts, lpFxConfig, lpFxPairs } from '@ntzs/db'
import { SubmitButton } from '../_components/SubmitButton'
import { formatDateEAT } from '@/lib/format-date'

async function setMidRateAction(formData: FormData) {
  'use server'
  await requireAnyRole(['super_admin'])
  const rate = parseInt(String(formData.get('midRateTZS') ?? ''), 10)
  if (isNaN(rate) || rate <= 0) throw new Error('Invalid rate')
  const { db } = getDb()
  await db
    .insert(lpFxConfig)
    .values({ id: 1, midRateTZS: rate })
    .onConflictDoUpdate({ target: lpFxConfig.id, set: { midRateTZS: rate, updatedAt: new Date() } })
  // Sync all active pairs so the bot and swap API use the same rate
  await db
    .update(lpFxPairs)
    .set({ midRate: String(rate), updatedAt: new Date() })
  revalidatePath('/backstage/simplefx')
}

async function toggleLpActiveAction(formData: FormData) {
  'use server'
  await requireAnyRole(['super_admin'])
  const id = String(formData.get('id') ?? '')
  const isActive = formData.get('isActive') === 'true'
  if (!id) throw new Error('Missing id')
  const { db } = getDb()
  await db
    .update(lpAccounts)
    .set({ isActive: !isActive, updatedAt: new Date() })
    .where(eq(lpAccounts.id, id))
  revalidatePath('/backstage/simplefx')
}

async function approveKycAction(formData: FormData) {
  'use server'
  await requireAnyRole(['super_admin'])
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '') as 'approved' | 'rejected'
  if (!id || !['approved', 'rejected'].includes(status)) throw new Error('Invalid params')
  const { db } = getDb()
  await db
    .update(lpAccounts)
    .set({ kycStatus: status, updatedAt: new Date() })
    .where(eq(lpAccounts.id, id))
  revalidatePath('/backstage/simplefx')
}

function KycBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    rejected: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.pending}`}>
      {status}
    </span>
  )
}

export default async function SimpleFXBackstagePage() {
  const { db } = getDb()

  const [config] = await db.select().from(lpFxConfig).where(eq(lpFxConfig.id, 1)).limit(1)
  const currentRate = config?.midRateTZS ?? 3750

  const lps = await db
    .select()
    .from(lpAccounts)
    .orderBy(desc(lpAccounts.createdAt))

  const activeCount = lps.filter((l) => l.isActive).length
  const pendingKyc = lps.filter((l) => l.kycStatus === 'pending').length

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/10 bg-zinc-950/50 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">SimpleFX</h1>
            <p className="mt-1 text-sm text-zinc-400">Market maker LP management &amp; rate configuration</p>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <span className="rounded-full bg-white/5 px-3 py-1">{lps.length} LPs</span>
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-400">{activeCount} active</span>
            {pendingKyc > 0 && (
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-400">{pendingKyc} KYC pending</span>
            )}
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Mid Rate Card */}
        <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
          <div className="flex items-start justify-between gap-8">
            <div>
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">Live Mid Rate</p>
              <p className="text-4xl font-light text-white tabular-nums">
                {currentRate.toLocaleString()}
                <span className="ml-2 text-base text-zinc-500">nTZS / USDC</span>
              </p>
              {config && (
                <p className="mt-1 text-xs text-zinc-600">Last updated {formatDateEAT(config.updatedAt)}</p>
              )}
            </div>
            <form action={setMidRateAction} className="flex items-end gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">New mid rate (nTZS per USDC)</label>
                <input
                  type="number"
                  name="midRateTZS"
                  defaultValue={currentRate}
                  min={1}
                  step={1}
                  className="w-40 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white tabular-nums focus:border-blue-500/50 focus:outline-none"
                />
              </div>
              <SubmitButton
                pendingText="Saving..."
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
              >
                Set Rate
              </SubmitButton>
            </form>
          </div>
        </div>

        {/* LP Accounts Table */}
        <div className="rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">
          <div className="border-b border-white/10 px-6 py-4">
            <h2 className="text-lg font-semibold text-white">LP Accounts</h2>
            <p className="text-sm text-zinc-500 mt-0.5">All registered market makers</p>
          </div>

          {lps.length === 0 ? (
            <div className="px-6 py-16 text-center text-zinc-600">No LP accounts yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-zinc-600 border-b border-white/5">
                    <th className="px-6 py-3">LP</th>
                    <th className="px-6 py-3">Wallet</th>
                    <th className="px-6 py-3">Spread (bid / ask)</th>
                    <th className="px-6 py-3">KYC</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Joined</th>
                    <th className="px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {lps.map((lp) => (
                    <tr key={lp.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <Link href={`/backstage/simplefx/${lp.id}`} className="hover:text-blue-400 transition-colors">
                          <p className="font-medium text-white">{lp.email}</p>
                          {lp.displayName && <p className="text-xs text-zinc-500">{lp.displayName}</p>}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs text-zinc-400">
                          {lp.walletAddress.slice(0, 6)}…{lp.walletAddress.slice(-4)}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-zinc-300">
                        {(lp.bidBps / 100).toFixed(2)}% / {(lp.askBps / 100).toFixed(2)}%
                      </td>
                      <td className="px-6 py-4">
                        <KycBadge status={lp.kycStatus} />
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          lp.isActive
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-zinc-500/10 text-zinc-500'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${lp.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                          {lp.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-500">{formatDateEAT(lp.createdAt)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {lp.kycStatus === 'pending' && (
                            <>
                              <form action={approveKycAction}>
                                <input type="hidden" name="id" value={lp.id} />
                                <input type="hidden" name="status" value="approved" />
                                <SubmitButton pendingText="..." className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20">
                                  KYC ✓
                                </SubmitButton>
                              </form>
                              <form action={approveKycAction}>
                                <input type="hidden" name="id" value={lp.id} />
                                <input type="hidden" name="status" value="rejected" />
                                <SubmitButton pendingText="..." className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400 hover:bg-rose-500/20">
                                  KYC ✗
                                </SubmitButton>
                              </form>
                            </>
                          )}
                          <form action={toggleLpActiveAction}>
                            <input type="hidden" name="id" value={lp.id} />
                            <input type="hidden" name="isActive" value={String(lp.isActive)} />
                            <SubmitButton
                              pendingText="..."
                              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                                lp.isActive
                                  ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                  : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                              }`}
                            >
                              {lp.isActive ? 'Deactivate' : 'Activate'}
                            </SubmitButton>
                          </form>
                          <Link
                            href={`/backstage/simplefx/${lp.id}`}
                            className="rounded-lg bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"
                          >
                            View →
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
