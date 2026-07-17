import Link from 'next/link'

import {
  fetchActivity,
  fetchRailHealth,
  fetchStuckWork,
  parseRange,
  RANGE_HOURS,
  type ActivityEvent,
  type Category,
  type Severity,
} from '@/lib/activity/feed'
import { formatDateEAT } from '@/lib/format-date'

export const dynamic = 'force-dynamic'

const CATEGORIES: Array<Category | 'all'> = [
  'all',
  'psp',
  'payment',
  'burn',
  'kyc',
  'partner',
  'enterprise',
  'admin',
  'other',
]

function SeverityBadge({ severity }: { severity: Severity }) {
  const styles: Record<Severity, string> = {
    error: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    info: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[severity]}`}>
      {severity}
    </span>
  )
}

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className="inline-flex items-center rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] font-medium text-zinc-400">
      {category}
    </span>
  )
}

function StatCard({ label, value, tone, href }: { label: string; value: number; tone: 'ok' | 'warn' | 'bad'; href?: string }) {
  const toneCls =
    value === 0
      ? 'text-zinc-500'
      : tone === 'bad'
        ? 'text-rose-400'
        : tone === 'warn'
          ? 'text-amber-400'
          : 'text-emerald-400'
  const body = (
    <div className="rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-3">
      <p className={`text-2xl font-semibold ${toneCls}`}>{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

function minutesAgo(d: Date): number {
  return Math.round((Date.now() - d.getTime()) / 60_000)
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; severity?: string; category?: string; q?: string }>
}) {
  const params = await searchParams
  const range = parseRange(params.range)
  const severityFilter = ['error', 'warning', 'info'].includes(params.severity ?? '')
    ? (params.severity as Severity)
    : null
  const categoryFilter = CATEGORIES.includes((params.category ?? '') as Category)
    ? (params.category as Category)
    : null
  const q = (params.q ?? '').trim()

  const [health, stuck, { events, truncated, sourceErrors }] = await Promise.all([
    fetchRailHealth(),
    fetchStuckWork(),
    fetchActivity({ hours: range.hours, q: q || undefined }),
  ])
  const dataProblems = [...sourceErrors, ...stuck.errors]

  const counts = {
    error: events.filter((e) => e.severity === 'error').length,
    warning: events.filter((e) => e.severity === 'warning').length,
    info: events.filter((e) => e.severity === 'info').length,
  }

  const visible = events
    .filter((e) => (severityFilter ? e.severity === severityFilter : true))
    .filter((e) => (categoryFilter ? e.category === categoryFilter : true))
    .slice(0, 300)

  const probeAgeMin = health.checkedAt ? minutesAgo(health.checkedAt) : null
  const probeStale = probeAgeMin !== null && probeAgeMin > 12

  const qs = (over: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      range: range.key,
      severity: severityFilter ?? undefined,
      category: categoryFilter ?? undefined,
      q: q || undefined,
      ...over,
    }
    const usp = new URLSearchParams()
    for (const [k, v] of Object.entries(merged)) if (v) usp.set(k, v)
    const s = usp.toString()
    return s ? `?${s}` : ''
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Activity &amp; Logs</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Everything the platform records — rail health, money movement, KYC, admin actions — one
            stream, filterable. Times are EAT.
          </p>
        </div>
        <Link
          href={`/backstage/activity${qs({})}`}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10"
        >
          Refresh
        </Link>
      </div>

      {dataProblems.length > 0 ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
          <p className="text-sm font-medium text-rose-400">
            Some data sources failed — the rest of the page is still live:
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs text-rose-300/90">
            {dataProblems.map((e, i) => (
              <li key={i} className="font-mono">{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Rail health strip */}
      <div className="mb-6 rounded-xl border border-white/10 bg-zinc-900/60 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm font-medium text-white">PSP rails</p>
          {health.rails.length === 0 ? (
            <p className="text-sm text-zinc-500">No health probes recorded yet.</p>
          ) : (
            health.rails.map((r) => (
              <span key={r.rail} className="inline-flex items-center gap-2 text-sm">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${r.healthy ? 'bg-emerald-400' : 'bg-rose-500 animate-pulse'}`}
                />
                <span className="text-zinc-300">{r.rail}</span>
                <span className={r.healthy ? 'text-emerald-400' : 'text-rose-400'}>
                  {r.healthy ? 'UP' : 'DOWN'}
                </span>
                {!r.healthy && r.error ? (
                  <span className="max-w-[28rem] truncate text-xs text-zinc-500" title={r.error}>
                    {r.error}
                  </span>
                ) : null}
              </span>
            ))
          )}
          {health.checkedAt ? (
            <span className={`ml-auto text-xs ${probeStale ? 'text-rose-400' : 'text-zinc-500'}`}>
              probed {probeAgeMin}m ago{probeStale ? ' — probe cron may be stuck' : ''}
            </span>
          ) : null}
        </div>
      </div>

      {/* Stuck-work counters */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Deposits awaiting payment" value={stuck.depositsSubmitted} tone="warn" href="/backstage/minting" />
        <StatCard label="…of which stuck >10 min" value={stuck.depositsStuck} tone="bad" href="/backstage/minting" />
        <StatCard label="Mint failed" value={stuck.mintFailed} tone="bad" href="/backstage/minting" />
        <StatCard label="Mint needs Safe approval" value={stuck.mintRequiresSafe} tone="warn" href="/backstage/minting" />
        <StatCard label="Orphan payments unmatched" value={stuck.orphansUnmatched} tone="warn" href="/backstage/minting" />
        <StatCard label="Payouts failed" value={stuck.payoutFailed} tone="bad" href="/backstage/burns" />
        <StatCard label="Burns failed" value={stuck.burnFailed} tone="bad" href="/backstage/burns" />
        <StatCard label="Burns in flight" value={stuck.burnsInFlight} tone="ok" href="/backstage/burns" />
        <StatCard label="KYC pending review" value={stuck.kycPending} tone="warn" href="/backstage/kyc" />
      </div>

      {/* Filters */}
      <form method="GET" className="mb-4 flex flex-wrap items-center gap-2">
        <select
          name="range"
          defaultValue={range.key}
          className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"
        >
          {Object.keys(RANGE_HOURS).map((k) => (
            <option key={k} value={k}>
              Last {k}
            </option>
          ))}
        </select>
        <select
          name="severity"
          defaultValue={severityFilter ?? ''}
          className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"
        >
          <option value="">All severities</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
          <option value="info">Info</option>
        </select>
        <select
          name="category"
          defaultValue={categoryFilter ?? ''}
          className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c === 'all' ? '' : c}>
              {c === 'all' ? 'All categories' : c}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search reference, phone, entity id, error text…"
          className="w-72 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-600"
        />
        <button
          type="submit"
          className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
        >
          Apply
        </button>
        <Link
          href={`/backstage/activity?range=24h&severity=error`}
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/20"
        >
          Errors · 24h
        </Link>
      </form>

      {/* Result summary */}
      <p className="mb-3 text-xs text-zinc-500">
        {events.length} events in the last {range.key}
        {q ? ` matching “${q}”` : ''} — {counts.error} errors · {counts.warning} warnings ·{' '}
        {counts.info} info. Showing {visible.length}
        {truncated ? ' (window truncated — narrow the range or search to see everything)' : ''}.
      </p>

      {/* Feed */}
      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3">Time (EAT)</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-zinc-950">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                  Nothing in this window with these filters.
                </td>
              </tr>
            ) : (
              visible.map((e, i) => <EventRow key={`${e.source}-${e.entityId}-${e.ts.getTime()}-${i}`} e={e} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function summarize(e: ActivityEvent): string | null {
  const d = e.detail
  if (!d) return null
  const bits: string[] = []
  if (typeof d.amountTzs === 'number') bits.push(`TZS ${Number(d.amountTzs).toLocaleString()}`)
  if (typeof d.provider === 'string') bits.push(String(d.provider))
  if (typeof d.rail === 'string') bits.push(`rail ${d.rail}`)
  if (typeof d.phone === 'string' && d.phone) bits.push(String(d.phone))
  if (typeof d.pspReference === 'string' && d.pspReference) bits.push(String(d.pspReference))
  const err = d.error ?? d.payoutError ?? d.reason
  if (typeof err === 'string' && err) bits.push(err)
  if (Array.isArray(d.transitions) && d.transitions.length) bits.push(d.transitions.join('; '))
  return bits.length ? bits.join(' · ') : null
}

function EventRow({ e }: { e: ActivityEvent }) {
  const summary = summarize(e)
  return (
    <tr className={e.severity === 'error' ? 'bg-rose-500/[0.04]' : undefined}>
      <td className="whitespace-nowrap px-4 py-2.5 align-top text-xs text-zinc-400">
        {formatDateEAT(e.ts)}
      </td>
      <td className="px-4 py-2.5 align-top">
        <SeverityBadge severity={e.severity} />
      </td>
      <td className="px-4 py-2.5 align-top">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-200">{e.action}</span>
          <CategoryBadge category={e.category} />
        </div>
        {summary ? <p className="mt-1 max-w-xl truncate text-xs text-zinc-500" title={summary}>{summary}</p> : null}
      </td>
      <td className="px-4 py-2.5 align-top text-xs text-zinc-500">
        {e.entityType ? (
          <>
            {e.entityType}
            <br />
            <span className="font-mono text-[11px] text-zinc-600">{(e.entityId ?? '').slice(0, 13)}</span>
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-2.5 align-top text-xs text-zinc-500">{e.actor ?? 'system'}</td>
      <td className="px-4 py-2.5 align-top">
        {e.detail ? (
          <details>
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">view</summary>
            <pre className="mt-2 max-h-64 max-w-md overflow-auto rounded-lg bg-black/60 p-3 text-[11px] leading-relaxed text-zinc-300">
              {JSON.stringify(e.detail, null, 2)}
            </pre>
          </details>
        ) : (
          <span className="text-xs text-zinc-700">—</span>
        )}
      </td>
    </tr>
  )
}
