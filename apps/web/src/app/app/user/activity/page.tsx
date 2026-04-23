import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedRecentDeposits, getCachedRecentBurns, getCachedRecentSends, getCachedRecentSwaps } from '@/lib/user/cachedQueries'
import { formatDateTimeEAT } from '@/lib/format-date'
import { ActivityList } from './_components/ActivityList'
import { PendingDepositPoller } from '../_components/PendingDepositPoller'
import { ActivityRefreshListener } from './_components/ActivityRefreshListener'

export default async function ActivityPage() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const [deposits, burns, sends, swaps] = await Promise.all([
    getCachedRecentDeposits(dbUser.id, 50),
    getCachedRecentBurns(dbUser.id, 50),
    getCachedRecentSends(dbUser.id, 50),
    getCachedRecentSwaps(dbUser.id, 50),
  ])

  const txns = [
    ...deposits.map((d) => ({
      type: 'deposit' as const,
      source: (d as Record<string, unknown>).source as string | undefined,
      payerName: (d as Record<string, unknown>).payerName as string | undefined,
      id: d.id,
      amountTzs: d.amountTzs,
      status: String(d.status),
      toAddress: undefined as string | undefined,
      mintTxHash: undefined as string | undefined,
      formattedDate: d.createdAt ? formatDateTimeEAT(d.createdAt) : '',
      createdAt: d.createdAt,
    })),
    ...burns.map((b) => ({
      type: 'burn' as const,
      source: undefined as string | undefined,
      payerName: undefined as string | undefined,
      id: b.id,
      amountTzs: b.amountTzs,
      status: String(b.status),
      toAddress: undefined as string | undefined,
      mintTxHash: undefined as string | undefined,
      formattedDate: b.createdAt ? formatDateTimeEAT(b.createdAt) : '',
      createdAt: b.createdAt,
    })),
    ...sends.map((s) => ({
      type: 'send' as const,
      source: undefined as string | undefined,
      payerName: undefined as string | undefined,
      id: s.id,
      amountTzs: s.amountTzs,
      status: 'sent',
      toAddress: s.toAddress,
      mintTxHash: s.mintTxHash,
      formattedDate: s.createdAt ? formatDateTimeEAT(s.createdAt) : '',
      createdAt: s.createdAt,
    })),
    ...swaps.map((sw) => ({
      type: 'swap' as const,
      source: undefined as string | undefined,
      payerName: undefined as string | undefined,
      id: sw.id,
      amountTzs: 0,
      status: 'filled',
      toAddress: undefined as string | undefined,
      mintTxHash: sw.outTxHash,
      formattedDate: sw.createdAt ? formatDateTimeEAT(sw.createdAt) : '',
      createdAt: sw.createdAt,
      fromSymbol: sw.fromToken,
      toSymbol: sw.toToken,
      amountIn: sw.amountIn,
      amountOut: sw.amountOut,
    })),
  ]
    .filter((t) => t.createdAt)
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    .slice(0, 50)

  const totalIn = deposits
    .filter((d) => d.status === 'minted')
    .reduce((s, d) => s + (d.amountTzs ?? 0), 0)

  const totalOut =
    burns.filter((b) => b.status === 'burned').reduce((s, b) => s + (b.amountTzs ?? 0), 0) +
    sends.reduce((s, t) => s + t.amountTzs, 0)

  const pendingCount = deposits.filter(
    (d) => !['minted', 'rejected', 'cancelled'].includes(d.status),
  ).length

  return (
    <div className="min-h-screen bg-[#0d0d14]">
      {/* Always-on: re-renders on any deposit/swap event + 15s background poll */}
      <ActivityRefreshListener />
      {/* Smart status poller — emits events when deposits transition */}
      <PendingDepositPoller hasPending={pendingCount > 0} />

      <div className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-2xl">

          {/* Page header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Activity</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Your full transaction history — {txns.length} record{txns.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Summary stats — single card */}
          <div className="mb-6 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-2xl divide-x divide-border/40 flex">
            <div className="flex-1 px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Total In</p>
              <p className="mt-2 text-xl font-bold text-emerald-400 truncate">{totalIn.toLocaleString()}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">TZS</p>
            </div>
            <div className="flex-1 px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Total Out</p>
              <p className="mt-2 text-xl font-bold text-rose-300 truncate">{totalOut.toLocaleString()}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">TZS</p>
            </div>
            <div className="flex-1 px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Pending</p>
              <p className="mt-2 text-xl font-bold text-amber-400">{pendingCount}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">deposits</p>
            </div>
          </div>

          {/* Transaction list */}
          {txns.length === 0 ? (
            <div className="rounded-2xl border border-border/40 bg-card/60 py-20 text-center backdrop-blur-2xl">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/40 bg-background/35">
                <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-foreground/80">No transactions yet</p>
              <p className="mt-1.5 text-xs text-muted-foreground">Make your first deposit to get started</p>
            </div>
          ) : (
            <ActivityList txns={txns} />
          )}

        </div>
      </div>
    </div>
  )
}
