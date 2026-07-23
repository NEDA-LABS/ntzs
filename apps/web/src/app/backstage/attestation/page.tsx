import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { requireAnyRole } from '@/lib/auth/rbac'
import { computeAttestation, generateDailyAttestation, isIncomplete } from '@/lib/attestation'

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

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

const SOURCE_BADGE: Record<string, string> = {
  api: 'bg-emerald-500/20 text-emerald-400',
  book: 'bg-amber-500/20 text-amber-400',
  env: 'bg-zinc-500/20 text-zinc-300',
}
const SOURCE_LABEL: Record<string, string> = {
  api: 'API-verified',
  book: 'book-derived',
  env: 'declared',
}

export default async function AttestationPage({
  searchParams,
}: {
  searchParams: Promise<{ actionError?: string; actionOk?: string }>
}) {
  await requireAnyRole(['platform_compliance', 'super_admin'])
  const { actionError, actionOk } = await searchParams

  const report = await computeAttestation()

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

      {isIncomplete(report) ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
          <p className="inline-block rounded-lg bg-amber-500/15 px-3 py-1.5 text-sm font-bold text-amber-400">
            ⚠ READING INCOMPLETE — would not attest
          </p>
          <p className="mt-3 text-sm text-zinc-300">
            One or more sources cannot be read right now. Sending is blocked for the regulator list;
            fix the sources below and refresh.
          </p>
          <ul className="mt-3 list-disc pl-5 text-sm text-zinc-400">
            {report.failures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
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
