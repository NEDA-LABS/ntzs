import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { lpAccounts, lpFxConfig, lpFxPairs } from '@ntzs/db'
import { SubmitButton } from '../_components/SubmitButton'
import { formatDateEAT, formatDateTimeEAT } from '@/lib/format-date'
import { readReconState } from '@/lib/fx/recon-state'
import type { ReconRunSummary } from '@/lib/fx/recon'

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

/**
 * Latest solver-pool reconciliation (written by /api/cron/fx-pool-reconcile
 * every 10 min): per-token ledger-vs-chain delta plus the Transfer-log sweep.
 */
function ReconStatusCard({ recon }: { recon: ReconRunSummary | null }) {
  if (!recon) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
        <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">Pool Reconciliation</p>
        <p className="text-sm text-zinc-500">
          No run recorded yet — the cron runs every 10 minutes and needs migration{' '}
          <code className="text-zinc-400">0065_fx_recon_state</code> applied.
        </p>
      </div>
    )
  }

  const styles = {
    ok: { border: 'border-white/10', dot: 'bg-emerald-400', pill: 'bg-emerald-500/10 text-emerald-400', label: 'Healthy' },
    info: { border: 'border-amber-500/30', dot: 'bg-amber-400', pill: 'bg-amber-500/10 text-amber-400', label: 'Surplus (fees accruing)' },
    critical: { border: 'border-rose-500/40', dot: 'bg-rose-400', pill: 'bg-rose-500/10 text-rose-400', label: 'Drift detected' },
  }[recon.status]

  const anomalyTotal = recon.sweeps.reduce((n, s) => n + s.anomalyCount, 0)

  return (
    <div className={`rounded-2xl border ${styles.border} bg-zinc-950 p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-xs uppercase tracking-widest text-zinc-500">Pool Reconciliation</p>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.pill}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
            {styles.label}
          </span>
          {anomalyTotal > 0 && (
            <span className="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-400">
              {anomalyTotal} unexplained transfer{anomalyTotal === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-600">
          Last run {formatDateTimeEAT(recon.ranAt)}
          {recon.alerted && <span className="ml-2 text-rose-400">alert emailed</span>}
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {recon.tokens.map((t) => {
          const deltaColor =
            t.status === 'deficit' ? 'text-rose-400' : t.status === 'surplus' ? 'text-amber-400' : 'text-emerald-400'
          return (
            <div key={`${t.chain}-${t.token}`} className="rounded-xl border border-white/5 bg-black/30 px-4 py-3">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium text-white">{t.token}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">{t.chain}</p>
              </div>
              <div className="mt-1.5 space-y-0.5 font-mono text-[11px] tabular-nums text-zinc-500">
                <p>claims+fees {t.expected}</p>
                <p>on-chain&nbsp;&nbsp;&nbsp; {t.onChain}</p>
                <p className={deltaColor}>
                  Δ {t.delta.startsWith('-') ? '' : '+'}
                  {t.delta}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600">
        {recon.sweeps.map((s) => (
          <span key={s.chain}>
            sweep {s.chain}:{' '}
            {s.skipped ? (
              <span className="text-amber-400/80">{s.skipped}</span>
            ) : (
              <>
                blocks {s.fromBlock.toLocaleString()}–{s.toBlock.toLocaleString()} · {s.transfers} transfers ·{' '}
                <span className={s.anomalyCount ? 'text-rose-400' : ''}>{s.anomalyCount} anomalous</span>
              </>
            )}
          </span>
        ))}
        {recon.chainsSkipped.map((s) => (
          <span key={s} className="text-zinc-700">
            {s}
          </span>
        ))}
      </div>
    </div>
  )
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

  // Fail-soft: null until the cron has run once (and migration 0065 is applied).
  const recon = await readReconState<ReconRunSummary>(db, 'last_run')

  const activeCount = lps.filter((l) => l.isActive).length
  const pendingKyc = lps.filter((l) => l.kycStatus === 'pending').length
  // Bank/institution applicants whose KYB documents are waiting on an admin —
  // without a dedicated queue these drowned in the table (3 Aug: a bank
  // applicant chased on WhatsApp because nobody saw their submission).
  const kybToReview = lps.filter((l) => l.kybStatus === 'submitted')

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
            {kybToReview.length > 0 && (
              <span className="rounded-full bg-blue-500/15 px-3 py-1 font-medium text-blue-300">
                {kybToReview.length} KYB to review
              </span>
            )}
            <Link
              href="/backstage/simplefx/fills"
              className="rounded-full bg-blue-500/10 px-3 py-1 text-blue-400 hover:bg-blue-500/20 transition-colors"
            >
              Swap History →
            </Link>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Solver-pool reconciliation status */}
        <ReconStatusCard recon={recon} />

        {/* Mid Rate Card */}
        <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
          <div className="flex items-start justify-between gap-8">
            <div>
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">Live Mid Rate</p>
              <p className="text-4xl font-light text-white tabular-nums">
                {currentRate.toLocaleString()}
                <span className="ml-2 text-base text-zinc-500">nTZS / USD</span>
              </p>
              {config && (
                <p className="mt-1 text-xs text-zinc-600">Last updated {formatDateEAT(config.updatedAt)}</p>
              )}
            </div>
            <form action={setMidRateAction} className="flex items-end gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">New mid rate (nTZS per USD)</label>
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

        {/* KYB review queue — submissions must never sit unnoticed in the table */}
        {kybToReview.length > 0 && (
          <div className="rounded-2xl border border-blue-500/30 bg-blue-600/[0.06] overflow-hidden">
            <div className="border-b border-blue-500/20 px-6 py-4">
              <h2 className="text-lg font-semibold text-white">Needs review</h2>
              <p className="text-sm text-zinc-400 mt-0.5">
                {kybToReview.length} bank/institution application{kybToReview.length === 1 ? '' : 's'} with submitted KYB documents awaiting a decision
              </p>
            </div>
            <ul className="divide-y divide-white/5">
              {kybToReview.map((lp) => (
                <li key={lp.id} className="flex items-center justify-between gap-4 px-6 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">
                      {lp.email}
                      <span className="ml-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-300 align-middle">
                        {lp.accountType}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">Joined {formatDateEAT(lp.createdAt)}</p>
                  </div>
                  <Link
                    href={`/backstage/simplefx/${lp.id}`}
                    className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
                  >
                    Review →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

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
                          <p className="font-medium text-white">
                            {lp.email}
                            {lp.accountType === 'bank' && (
                              <span className="ml-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-300 align-middle">
                                bank
                              </span>
                            )}
                          </p>
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
