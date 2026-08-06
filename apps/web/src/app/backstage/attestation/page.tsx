import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { desc, eq } from 'drizzle-orm'

import { requireAnyRole, getCurrentDbUser } from '@/lib/auth/rbac'
import { computeAttestation, generateDailyAttestation, isIncomplete } from '@/lib/attestation'
import { writeAuditLog } from '@/lib/audit'
import { getDb } from '@/lib/db'
import { formatDateEAT } from '@/lib/format-date'
import { reserveStatements } from '@ntzs/db'

export const dynamic = 'force-dynamic'

/**
 * Backstage → Attestation: live preview of today's reserve attestation
 * (nothing sent, nothing persisted) + the recovery/manual-send button.
 *
 * This is the one-click path referenced by the INCOMPLETE ops alert: fix the
 * failing source, open this page to confirm the preview reads clean, then
 * send — the day's row is upserted, so a re-send after an incident replaces
 * nothing and BoT receives exactly one attestation per report date (the
 * latest send wins the record).
 */

async function sendNowAction() {
  'use server'
  await requireAnyRole(['super_admin'])
  const r = await generateDailyAttestation()
  revalidatePath('/backstage/attestation')
  if (isIncomplete(r)) {
    redirect(
      '/backstage/attestation?actionError=' +
        encodeURIComponent(
          `Reading incomplete — NOT sent to the attestation list (ops alert emailed instead). ${r.failures.join(' · ')}`.slice(0, 400)
        )
    )
  }
  redirect(
    '/backstage/attestation?actionOk=' +
      encodeURIComponent(
        `Attestation for ${r.reportDate} generated, persisted and emailed — deviation ${r.deviationPct.toFixed(4)}%, adjusted coverage ${r.annex.adjustedCoveragePct.toFixed(4)}%.`
      )
  )
}

/**
 * Record a balance the provider stated to us while its API is unavailable.
 *
 * This is the daily-CSV path: the custodian tells us what we hold, an operator
 * types it here, and the attestation uses it in preference to carrying our own
 * last reading forward — it is current and it comes from the custodian. The
 * statement's OWN date is captured, never the entry time, so filing Tuesday's
 * statement on Thursday cannot make it look like Thursday's balance.
 */
async function recordStatementAction(formData: FormData) {
  'use server'
  await requireAnyRole(['super_admin', 'platform_compliance'])
  const operator = await getCurrentDbUser()
  if (!operator) throw new Error('User not found')

  const potKey = String(formData.get('potKey') ?? '').trim()
  const amountRaw = String(formData.get('amountTzs') ?? '').replace(/[\s,]/g, '')
  const asOfRaw = String(formData.get('asOf') ?? '').trim()
  const reference = String(formData.get('reference') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!['snippe', 'azampay', 'selcom'].includes(potKey)) throw new Error('Unknown reserve pot')

  const amountTzs = Number(amountRaw)
  if (!Number.isFinite(amountTzs) || amountTzs < 0) throw new Error('Amount must be a number of TZS, zero or more')

  // The statement's date decides how the figure ages. A future one would never
  // expire, so it is refused rather than clamped.
  const asOf = new Date(asOfRaw)
  if (Number.isNaN(asOf.getTime())) throw new Error('Statement date is required')
  if (asOf.getTime() > Date.now() + 60 * 60 * 1000) throw new Error('Statement date cannot be in the future')

  // Evidence, not vibes: without a reference nobody can ask the provider for
  // the document this figure came from.
  if (!reference) throw new Error('A statement reference (file name or statement id) is required')

  const { db } = getDb()
  await db.insert(reserveStatements).values({
    potKey,
    amountTzs: amountTzs.toFixed(2),
    asOf,
    reference,
    note: note || null,
    enteredByUserId: operator.id,
  })

  await writeAuditLog(
    'attestation.statement_recorded',
    'reserve_pot',
    potKey,
    { amountTzs, asOf: asOf.toISOString(), reference, note: note || null },
    operator.id
  )
  revalidatePath('/backstage/attestation')
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

const SOURCE_BADGE: Record<string, string> = {
  api: 'bg-emerald-500/20 text-emerald-400',
  statement: 'bg-sky-500/20 text-sky-300',
  book: 'bg-amber-500/20 text-amber-400',
  env: 'bg-zinc-500/20 text-zinc-300',
  stale: 'bg-orange-500/20 text-orange-300',
}
const SOURCE_LABEL: Record<string, string> = {
  api: 'API-verified',
  statement: 'provider statement',
  book: 'book-derived',
  env: 'declared',
  stale: 'carried forward',
}

export default async function AttestationPage({
  searchParams,
}: {
  searchParams: Promise<{ actionError?: string; actionOk?: string }>
}) {
  await requireAnyRole(['platform_compliance', 'super_admin'])
  const { actionError, actionOk } = await searchParams

  const report = await computeAttestation()

  // Recent statements, so an operator can see what has been filed and spot a
  // gap before the carry-forward clock runs out.
  let recentStatements: Array<{
    potKey: string
    amountTzs: string
    asOf: Date
    reference: string | null
  }> = []
  try {
    const { db } = getDb()
    recentStatements = await db
      .select({
        potKey: reserveStatements.potKey,
        amountTzs: reserveStatements.amountTzs,
        asOf: reserveStatements.asOf,
        reference: reserveStatements.reference,
      })
      .from(reserveStatements)
      .orderBy(desc(reserveStatements.asOf), desc(reserveStatements.createdAt))
      .limit(8)
  } catch {
    // Table arrives with 0077 — until then there is simply nothing to show.
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Reserve Attestation</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Live preview — nothing is sent or stored until you send. The 10:00 EAT cron sends automatically.
          </p>
        </div>
        <form action={sendNowAction}>
          <button
            type="submit"
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            Generate &amp; send now
          </button>
        </form>
      </div>

      {actionError && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {actionError}
        </div>
      )}
      {actionOk && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {actionOk}
        </div>
      )}

      {/* Provider statement entry — the daily-CSV path while an API is down */}
      <details className="mb-6 rounded-2xl border border-white/10 bg-zinc-950 p-5" open={isIncomplete(report)}>
        <summary className="cursor-pointer text-sm font-semibold text-zinc-200">
          Record a provider statement balance
          <span className="ml-2 text-xs font-normal text-zinc-500">
            for when a provider&apos;s API is unavailable but it still sends us a statement
          </span>
        </summary>

        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-zinc-500">
          The attestation prefers this to carrying our own last reading forward: it is current and it comes from the
          custodian. It still qualifies the attestation, because a human typed it, and it ages out on the same{' '}
          <code className="text-zinc-400">ATTESTATION_MAX_STALE_DAYS</code> clock — so keep filing them daily while the
          API is down, or the report reverts to INCOMPLETE.
        </p>

        <form action={recordStatementAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Reserve pot</label>
            <select name="potKey" defaultValue="snippe" className="w-full rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm text-white focus:border-emerald-500/50 focus:outline-none">
              <option value="snippe">Snippe</option>
              <option value="azampay">AzamPay</option>
              <option value="selcom">Selcom</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Balance (TZS)</label>
            <input name="amountTzs" required inputMode="decimal" placeholder="2300000" className="w-full rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Statement date <span className="text-zinc-600">(not today)</span>
            </label>
            <input name="asOf" type="date" required className="w-full rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm text-white focus:border-emerald-500/50 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Statement reference</label>
            <input name="reference" required placeholder="e.g. snippe-balance-2026-08-07.csv" className="w-full rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none" />
          </div>
          <div className="flex items-end">
            <button type="submit" className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500">
              Record
            </button>
          </div>
        </form>

        {recentStatements.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-zinc-400">Recently filed</p>
            <div className="space-y-1.5">
              {recentStatements.map((st, i) => (
                <div key={`${st.potKey}-${st.asOf.toISOString()}-${i}`} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                  <span className="font-mono text-zinc-300">{st.potKey}</span>
                  <span className="text-white">TZS {fmt(Number(st.amountTzs))}</span>
                  <span className="text-zinc-500">as at {formatDateEAT(st.asOf)}</span>
                  {st.reference && <span className="text-zinc-600">· {st.reference}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </details>

      {isIncomplete(report) ? (
        <div className="space-y-4">
          {/* Reserve position FIRST — an incomplete reading must never look
              like a solvency problem when 9 of 10 sources read fine. */}
          {(report.partial.supplyTzs != null || report.partial.pots.length > 0) && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                  What we CAN read right now
                </h2>
                <span className="rounded-full bg-zinc-500/20 px-3 py-1 text-xs font-bold text-zinc-300">
                  PROVISIONAL — NOT ATTESTED
                </span>
              </div>
              <dl className="space-y-2 text-sm">
                {report.partial.supplyTzs != null && (
                  <div className="flex justify-between"><dt className="text-zinc-400">On-chain supply</dt><dd className="font-semibold text-white">{fmt(report.partial.supplyTzs)} nTZS</dd></div>
                )}
                {report.partial.pots.map((p) => (
                  <div key={p.key} className="flex justify-between"><dt className="text-zinc-400">{p.label}</dt><dd className="font-semibold text-white">TZS {fmt(p.amountTzs)}</dd></div>
                ))}
                {report.partial.provisionalCoveragePct != null && (
                  <div className="flex justify-between border-t border-white/10 pt-2">
                    <dt className="font-semibold text-zinc-200">Provisional raw coverage</dt>
                    <dd className={`font-bold ${report.partial.provisionalCoveragePct >= 100 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {report.partial.provisionalCoveragePct.toFixed(2)} %
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
            <p className="inline-block rounded-lg bg-amber-500/15 px-3 py-1.5 text-sm font-bold text-amber-400">
              ⚠ READING INCOMPLETE — would not attest
            </p>
            <p className="mt-3 text-sm text-zinc-300">
              The source(s) below cannot be read, so the attestation cannot be finalized or sent to the
              regulator list. Fix and refresh — everything above already reads correctly.
            </p>
            <ul className="mt-3 list-disc pl-5 text-sm text-zinc-400">
              {report.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* BoT block */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                BoT figures · {report.reportDate}
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  report.fullyBacked ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                }`}
              >
                {report.fullyBacked ? 'FULLY BACKED' : 'UNDER-BACKED'}
              </span>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-400">(a) nTZS in circulation</dt><dd className="font-semibold text-white">{fmt(report.ntzsCirculation)} nTZS</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">(b) Custodial reserve</dt><dd className="font-semibold text-white">TZS {fmt(report.tzsCustodialReserve)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">(c) Govt securities</dt><dd className="font-semibold text-white">TZS {fmt(report.tzsGovtSecurities)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Total reserve</dt><dd className="font-semibold text-white">TZS {fmt(report.reserveTotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">(d) Deviation from 1:1</dt><dd className="font-semibold text-white">{report.deviationPct.toFixed(4)} %</dd></div>
              <div className="flex justify-between border-t border-white/10 pt-2"><dt className="text-zinc-400">Base block</dt><dd className="text-zinc-300">{report.blockNumber ?? 'n/a'}</dd></div>
            </dl>
          </div>

          {/* Adjusted coverage */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Reconciliation to 1:1
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-400">Gross reserves</dt><dd className="font-semibold text-white">TZS {fmt(report.annex.grossReservesTzs)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">− Burned, payout not executed</dt><dd className="text-zinc-300">TZS {fmt(report.annex.nettings.burnedUnpaidTzs)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">− Fees not re-minted</dt><dd className="text-zinc-300">TZS {fmt(report.annex.nettings.feesUnmintedTzs)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">− Unmatched orphans</dt><dd className="text-zinc-300">TZS {fmt(report.annex.nettings.orphanUnmatchedTzs)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Backing reserves</dt><dd className="font-semibold text-white">TZS {fmt(report.annex.backingReservesTzs)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Supply + mints owed</dt><dd className="text-zinc-300">TZS {fmt(report.annex.effectiveObligationsTzs)}</dd></div>
              <div className="flex justify-between border-t border-white/10 pt-2"><dt className="font-semibold text-zinc-200">Adjusted coverage</dt><dd className="font-bold text-white">{report.annex.adjustedCoveragePct.toFixed(4)} %</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Unexplained residual</dt><dd className={`font-semibold ${report.annex.residualPct < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{report.annex.residualPct >= 0 ? '+' : ''}{report.annex.residualPct.toFixed(4)} %</dd></div>
            </dl>
          </div>

          {/* Pots */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 lg:col-span-2">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Reserve composition
            </h2>
            <div className="space-y-3">
              {report.annex.pots.map((p) => (
                <div key={p.key} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-white">{p.label}</p>
                    {p.note && <p className="mt-0.5 text-xs text-zinc-500">{p.note}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${SOURCE_BADGE[p.source]}`}>
                      {SOURCE_LABEL[p.source]}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-white">TZS {fmt(p.amountTzs)}</span>
                  </div>
                </div>
              ))}
            </div>
            {report.annex.notes && report.annex.notes.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                {report.annex.notes.map((n, i) => (
                  <p key={i} className="text-xs text-amber-400">⚠ {n}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
