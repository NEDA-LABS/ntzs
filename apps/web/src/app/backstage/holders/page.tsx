import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import { NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { formatDateEAT } from '@/lib/format-date'
import { loadHoldersView, hasUnattributedBalance, type HolderRow } from '@/lib/holders'

export const dynamic = 'force-dynamic'

/**
 * The holders register: every nTZS holder matched to their identity state.
 *
 * The on-chain holder list is public — anyone can read it on Basescan — so
 * this page keeps the platform's answer ready before it is asked: each
 * address is a verified participant or a named platform account, the sum
 * reconciles to the on-chain supply, and the whole register exports to CSV
 * in one click. Balances are read live from the chain; a failed read shows
 * as a failed read, never as zero.
 */

type ViewFilter = 'holding' | 'all' | 'active' | 'attention'

const FILTERS: Array<{ key: ViewFilter; label: string }> = [
  { key: 'holding', label: 'Holding balance' },
  { key: 'active', label: 'Active 30d' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'all', label: 'All wallets' },
]

function needsAttention(h: HolderRow): boolean {
  return ((h.balanceTzs ?? 0) > 0 && h.kycStatus !== 'approved') || h.frozen || h.balanceTzs == null
}

function applyFilter(holders: HolderRow[], view: ViewFilter): HolderRow[] {
  switch (view) {
    case 'holding':
      return holders.filter((h) => (h.balanceTzs ?? 0) > 0 || h.balanceTzs == null)
    case 'active':
      return holders.filter((h) => h.activity30d > 0)
    case 'attention':
      return holders.filter(needsAttention)
    case 'all':
      return holders
  }
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function KycBadge({ status }: { status: string | null }) {
  const styles =
    status === 'approved'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : status === 'pending' || status === 'review'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : status == null
          ? 'border-white/10 bg-white/5 text-zinc-400'
          : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${styles}`}>
      {status ?? 'no case'}
    </span>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/50 px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  )
}

export default async function HoldersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  await requireAnyRole(['super_admin', 'platform_compliance', 'bank_admin', 'bot_regulator'])

  const params = await searchParams
  const view: ViewFilter = (FILTERS.find((f) => f.key === params.view)?.key ?? 'holding') as ViewFilter

  const data = await loadHoldersView()
  const rows = applyFilter(data.holders, view)
  const unverifiedHolding = data.holdingCount - data.holdingVerifiedCount
  const basescanToken = NTZS_CONTRACT_ADDRESS_BASE
    ? `https://basescan.org/token/${NTZS_CONTRACT_ADDRESS_BASE}`
    : null

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="flex flex-wrap items-end justify-between gap-4 px-8 py-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Holders</h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Every nTZS holder matched to their identity-verification state, reconciled against the on-chain
              supply. The holder list is public on the explorer; this register is the platform&rsquo;s answer to it —
              kept ready, not assembled on request.
            </p>
          </div>
          <div className="flex gap-3">
            {basescanToken && (
              <a
                href={`${basescanToken}#balances`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10"
              >
                Cross-check on Basescan ↗
              </a>
            )}
            <a
              href="/backstage/holders/export"
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15"
            >
              Export CSV
            </a>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="On-chain supply"
            value={data.supplyTzs == null ? 'unavailable' : `${data.supplyTzs.toLocaleString()} nTZS`}
            sub={data.supplyTzs == null ? data.chainError : 'totalSupply(), Base mainnet'}
          />
          <Stat
            label="Attributed to known accounts"
            value={`${data.attributedTzs.toLocaleString()} nTZS`}
            sub={
              data.unattributedTzs == null
                ? 'reconciliation incomplete — see below'
                : `unattributed: ${data.unattributedTzs.toLocaleString()}`
            }
          />
          <Stat
            label="Participants holding"
            value={String(data.holdingCount)}
            sub={`${data.holders.length} wallets on register`}
          />
          <Stat
            label="Identity coverage of holders"
            value={data.holdingCount ? `${data.holdingVerifiedCount} of ${data.holdingCount}` : '—'}
            sub="approved verification case"
          />
        </div>

        {data.chainError && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-6 py-4 text-sm text-amber-200">
            {data.chainError}
          </div>
        )}
        {data.failedReads > 0 && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-6 py-4 text-sm text-amber-200">
            {data.failedReads} balance read{data.failedReads === 1 ? '' : 's'} failed — shown as{' '}
            <span className="font-medium">read failed</span>, excluded from the totals, and the reconciliation
            figure is withheld until every read succeeds. Reload to retry.
          </div>
        )}
        {hasUnattributedBalance(data) && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
            <span className="font-semibold">
              {data.unattributedTzs!.toLocaleString()} nTZS is not attributable to a registered wallet or named
              platform account.
            </span>{' '}
            Identify the holding address on the explorer and either register it or record why it holds tokens —
            an unexplained holder is the first thing an inspector will find.
          </div>
        )}
        {unverifiedHolding > 0 && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
            {unverifiedHolding} participant{unverifiedHolding === 1 ? '' : 's'} holding a balance without an
            approved verification case — listed under <span className="font-medium">Needs attention</span>.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/backstage/holders?view=${f.key}`}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                view === f.key
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-zinc-900/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3">Holder</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">KYC</th>
                <th className="px-4 py-3 text-right">Balance (nTZS)</th>
                <th className="px-4 py-3 text-right">Activity 30d</th>
                <th className="px-4 py-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.systemAccounts.map((s) => (
                <tr key={s.address} className="border-b border-white/5 bg-white/[0.02]">
                  <td className="px-4 py-3 text-zinc-300">
                    {s.label}
                    <span className="ml-2 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                      platform
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    {basescanToken ? (
                      <a
                        href={`${basescanToken}?a=${s.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-zinc-200"
                      >
                        {short(s.address)}
                      </a>
                    ) : (
                      short(s.address)
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">—</td>
                  <td className="px-4 py-3 text-right font-medium text-white">
                    {s.balanceTzs == null ? (
                      <span className="text-amber-300">read failed</span>
                    ) : (
                      s.balanceTzs.toLocaleString()
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-500">—</td>
                  <td className="px-4 py-3 text-zinc-500">—</td>
                </tr>
              ))}
              {rows.map((h) => (
                <tr key={h.address} className="border-b border-white/5 last:border-b-0">
                  <td className="px-4 py-3">
                    {/* The verified legal name leads; the account it belongs to
                        is secondary. A holder with no verified name is shown as
                        unnamed rather than being labelled with an email. */}
                    {h.verifiedName ? (
                      <>
                        <span className="text-zinc-100">{h.verifiedName}</span>
                        <span className="ml-2 text-xs text-zinc-500">{h.email}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-zinc-500 italic">no verified name</span>
                        <span className="ml-2 text-xs text-zinc-500">{h.email}</span>
                      </>
                    )}
                    <span className="ml-2 text-xs text-zinc-600">{h.role}</span>
                    {h.frozen && (
                      <span className="ml-2 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-300">
                        frozen
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    {basescanToken ? (
                      <a
                        href={`${basescanToken}?a=${h.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-zinc-200"
                      >
                        {short(h.address)}
                      </a>
                    ) : (
                      short(h.address)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <KycBadge status={h.kycStatus} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-white">
                    {h.balanceTzs == null ? (
                      <span className="text-amber-300">read failed</span>
                    ) : (
                      h.balanceTzs.toLocaleString()
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300">{h.activity30d}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {h.lastActivityAt ? formatDateEAT(new Date(h.lastActivityAt)) : 'never'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-500">
                    Nothing matches this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="pb-4 text-xs leading-relaxed text-zinc-600">
          Balances are read live from Base mainnet at page load ({data.holders.length} addresses). Identity data
          comes from the wallet register and the latest verification case per participant. The BoT return&rsquo;s
          §6 &ldquo;Most active participants&rdquo; figure is computed from the same records.
        </p>
      </div>
    </div>
  )
}
