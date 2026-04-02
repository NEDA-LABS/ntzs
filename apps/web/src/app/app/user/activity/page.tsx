import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedRecentDeposits, getCachedRecentBurns, getCachedRecentSends } from '@/lib/user/cachedQueries'
import { formatDateTimeEAT } from '@/lib/format-date'
import { ActivityList } from './_components/ActivityList'
import { PendingDepositPoller } from '../_components/PendingDepositPoller'

export default async function ActivityPage() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const [deposits, burns, sends] = await Promise.all([
    getCachedRecentDeposits(dbUser.id, 50),
    getCachedRecentBurns(dbUser.id, 50),
    getCachedRecentSends(dbUser.id, 50),
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
    <div className="min-h-screen bg-[#0d0d14] px-4 pt-4 pb-24 lg:px-8 lg:pt-6">
      <PendingDepositPoller hasPending={pendingCount > 0} />

      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-lg font-bold text-white">Activity</h1>
        <p className="mt-0.5 text-xs text-zinc-600">
          {txns.length} transaction{txns.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Summary stats */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-[#12121e] p-4 ring-1 ring-white/[0.06]">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Total In</p>
          <p className="mt-2 text-base font-bold text-emerald-400">
            {totalIn.toLocaleString()}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-600">TZS</p>
        </div>
        <div className="rounded-2xl bg-[#12121e] p-4 ring-1 ring-white/[0.06]">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Total Out</p>
          <p className="mt-2 text-base font-bold text-rose-300">
            {totalOut.toLocaleString()}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-600">TZS</p>
        </div>
        <div className="rounded-2xl bg-[#12121e] p-4 ring-1 ring-white/[0.06]">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Pending</p>
          <p className="mt-2 text-base font-bold text-amber-400">
            {pendingCount}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-600">deposits</p>
        </div>
      </div>

      {/* Transaction list with filter tabs */}
      {txns.length === 0 ? (
        <div className="rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06] py-16 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04]">
            <svg className="h-6 w-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-400">No transactions yet</p>
          <p className="mt-1 text-xs text-zinc-600">Make your first deposit to get started</p>
        </div>
      ) : (
        <ActivityList txns={txns} />
      )}
    </div>
  )
}
