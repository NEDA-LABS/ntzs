import { desc, eq, sql, and } from 'drizzle-orm'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import {
  fundManagers,
  savingsProducts,
  savingsPositions,
  savingsTransactions,
  yieldAccruals,
  users,
} from '@ntzs/db'
import { formatDateTimeEAT } from '@/lib/format-date'

export default async function SavingsTvlPage() {
  await requireAnyRole(['super_admin', 'bank_admin'])

  const { db } = getDb()

  // ── Summary aggregates ────────────────────────────────────────────────────
  const [summary] = await db
    .select({
      totalTvl: sql<number>`coalesce(sum(case when ${savingsPositions.status} = 'active' then ${savingsPositions.principalTzs} else 0 end), 0)`.mapWith(Number),
      totalYieldOwed: sql<number>`coalesce(sum(case when ${savingsPositions.status} = 'active' then ${savingsPositions.accruedYieldTzs} else 0 end), 0)`.mapWith(Number),
      totalDepositedAllTime: sql<number>`coalesce(sum(${savingsPositions.totalDepositedTzs}), 0)`.mapWith(Number),
      totalWithdrawnAllTime: sql<number>`coalesce(sum(${savingsPositions.totalWithdrawnTzs}), 0)`.mapWith(Number),
      activeSavers: sql<number>`count(case when ${savingsPositions.status} = 'active' and ${savingsPositions.principalTzs} > 0 then 1 end)`.mapWith(Number),
      totalPositions: sql<number>`count(${savingsPositions.id})`.mapWith(Number),
    })
    .from(savingsPositions)

  const netExposure = (summary?.totalTvl ?? 0) + (summary?.totalYieldOwed ?? 0)

  // ── Per fund manager breakdown ────────────────────────────────────────────
  const fmRows = await db
    .select({
      fmId: fundManagers.id,
      fmName: fundManagers.name,
      fmStatus: fundManagers.status,
      fmTvlLimit: fundManagers.tvlLimitTzs,
      productId: savingsProducts.id,
      productName: savingsProducts.name,
      productRate: savingsProducts.annualRateBps,
      productStatus: savingsProducts.status,
      productTvl: sql<number>`coalesce(sum(case when ${savingsPositions.status} = 'active' then ${savingsPositions.principalTzs} else 0 end), 0)`.mapWith(Number),
      productSavers: sql<number>`count(case when ${savingsPositions.status} = 'active' and ${savingsPositions.principalTzs} > 0 then 1 end)`.mapWith(Number),
    })
    .from(fundManagers)
    .leftJoin(savingsProducts, eq(savingsProducts.fundManagerId, fundManagers.id))
    .leftJoin(savingsPositions, eq(savingsPositions.productId, savingsProducts.id))
    .groupBy(
      fundManagers.id,
      fundManagers.name,
      fundManagers.status,
      savingsProducts.id,
      savingsProducts.name,
      savingsProducts.annualRateBps,
      savingsProducts.status,
    )
    .orderBy(fundManagers.name)

  // Group by fund manager
  const fmMap = new Map<string, {
    id: string; name: string; status: string; tvlLimit: number | null
    products: { id: string; name: string; rate: number; status: string; tvl: number; savers: number }[]
  }>()
  for (const row of fmRows) {
    if (!fmMap.has(row.fmId)) {
      fmMap.set(row.fmId, { id: row.fmId, name: row.fmName, status: row.fmStatus, tvlLimit: (row.fmTvlLimit as number | null) ?? null, products: [] })
    }
    if (row.productId) {
      fmMap.get(row.fmId)!.products.push({
        id: row.productId,
        name: row.productName!,
        rate: row.productRate!,
        status: row.productStatus!,
        tvl: row.productTvl,
        savers: row.productSavers,
      })
    }
  }
  const fundManagerList = Array.from(fmMap.values())

  // ── Active positions (sorted by principal desc, limit 50) ─────────────────
  const positions = await db
    .select({
      id: savingsPositions.id,
      principalTzs: savingsPositions.principalTzs,
      accruedYieldTzs: savingsPositions.accruedYieldTzs,
      annualRateBps: savingsPositions.annualRateBps,
      status: savingsPositions.status,
      openedAt: savingsPositions.openedAt,
      userEmail: users.email,
      userName: users.name,
      productName: savingsProducts.name,
    })
    .from(savingsPositions)
    .leftJoin(users, eq(users.id, savingsPositions.userId))
    .leftJoin(savingsProducts, eq(savingsProducts.id, savingsPositions.productId))
    .where(and(eq(savingsPositions.status, 'active')))
    .orderBy(desc(savingsPositions.principalTzs))
    .limit(50)

  // ── Recent savings transactions (last 30) ─────────────────────────────────
  const recentTxns = await db
    .select({
      id: savingsTransactions.id,
      type: savingsTransactions.type,
      amountTzs: savingsTransactions.amountTzs,
      status: savingsTransactions.status,
      createdAt: savingsTransactions.createdAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(savingsTransactions)
    .leftJoin(users, eq(users.id, savingsTransactions.userId))
    .orderBy(desc(savingsTransactions.createdAt))
    .limit(30)

  // ── Daily accrual history (last 21 days) ─────────────────────────────────
  const accrualHistory = await db
    .select({
      date: yieldAccruals.date,
      totalAccrued: sql<number>`sum(${yieldAccruals.accruedTzs})`.mapWith(Number),
      positionCount: sql<number>`count(distinct ${yieldAccruals.positionId})`.mapWith(Number),
    })
    .from(yieldAccruals)
    .groupBy(yieldAccruals.date)
    .orderBy(desc(yieldAccruals.date))
    .limit(21)

  const now = new Date()

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-8 text-white">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Savings TVL</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Fund manager reporting — updated {formatDateTimeEAT(now)}
          </p>
        </div>
        <div className="rounded-xl bg-emerald-500/10 px-3 py-1.5 ring-1 ring-emerald-500/20">
          <p className="text-xs font-semibold text-emerald-400">Live</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          { label: 'Total TVL', value: (summary?.totalTvl ?? 0).toLocaleString(), sub: 'TZS locked in savings', color: 'text-violet-400' },
          { label: 'Yield Owed', value: (summary?.totalYieldOwed ?? 0).toLocaleString(), sub: 'Accrued, not yet settled', color: 'text-amber-400' },
          { label: 'Net Exposure', value: netExposure.toLocaleString(), sub: 'TVL + yield owed', color: 'text-rose-400' },
          { label: 'Active Savers', value: String(summary?.activeSavers ?? 0), sub: 'positions with principal > 0', color: 'text-blue-400' },
          { label: 'Total Deposited', value: (summary?.totalDepositedAllTime ?? 0).toLocaleString(), sub: 'All time', color: 'text-emerald-400' },
          { label: 'Total Withdrawn', value: (summary?.totalWithdrawnAllTime ?? 0).toLocaleString(), sub: 'All time', color: 'text-zinc-300' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/[0.07]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">{label}</p>
            <p className={`mt-2 text-2xl font-bold font-mono ${color}`}>{value}</p>
            <p className="mt-0.5 text-[11px] text-zinc-600">{sub}</p>
          </div>
        ))}
      </div>

      {/* Fund manager breakdown */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Fund Manager Breakdown
        </h2>
        {fundManagerList.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.03] p-8 text-center ring-1 ring-white/[0.06]">
            <p className="text-sm text-zinc-600">No fund managers configured yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {fundManagerList.map((fm) => {
              const fmTvl = fm.products.reduce((s, p) => s + p.tvl, 0)
              const utilizationPct = fm.tvlLimit && fm.tvlLimit > 0
                ? Math.min(100, Math.round((fmTvl / fm.tvlLimit) * 100))
                : null

              return (
                <div key={fm.id} className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/[0.07]">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15">
                        <svg className="h-4 w-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-white">{fm.name}</p>
                        <p className="text-xs text-zinc-600">
                          {fm.products.length} product{fm.products.length !== 1 ? 's' : ''}
                          {fm.tvlLimit ? ` · Limit: ${fm.tvlLimit.toLocaleString()} TZS` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-lg font-bold text-violet-400">{fmTvl.toLocaleString()}</p>
                      <p className="text-[11px] text-zinc-600">TZS managed</p>
                    </div>
                  </div>

                  {/* TVL utilization bar */}
                  {utilizationPct !== null && (
                    <div className="mb-4">
                      <div className="mb-1 flex justify-between text-[11px] text-zinc-600">
                        <span>TVL utilization</span>
                        <span>{utilizationPct}% of {fm.tvlLimit!.toLocaleString()} TZS limit</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={`h-full rounded-full transition-all ${utilizationPct >= 90 ? 'bg-rose-500' : utilizationPct >= 70 ? 'bg-amber-400' : 'bg-violet-500'}`}
                          style={{ width: `${utilizationPct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Products */}
                  {fm.products.length > 0 && (
                    <div className="divide-y divide-white/[0.04]">
                      {fm.products.map((p) => (
                        <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${p.status === 'active' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                            <span className="text-zinc-300">{p.name}</span>
                            <span className="text-xs text-zinc-600">{p.rate / 100}% p.a.</span>
                          </div>
                          <div className="flex items-center gap-6 text-right">
                            <div>
                              <p className="font-mono text-sm font-semibold text-white">{p.tvl.toLocaleString()}</p>
                              <p className="text-[10px] text-zinc-600">TZS</p>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-zinc-400">{p.savers}</p>
                              <p className="text-[10px] text-zinc-600">savers</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active positions table */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Active Positions ({positions.length})
          </h2>
          <div className="overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.07]">
            {positions.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-600">No active positions yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                      <th className="px-4 py-3">Saver</th>
                      <th className="px-4 py-3 text-right">Principal</th>
                      <th className="px-4 py-3 text-right">Yield</th>
                      <th className="px-4 py-3 text-right">Rate</th>
                      <th className="px-4 py-3">Opened</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {positions.map((pos) => (
                      <tr key={pos.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <p className="font-medium text-white truncate max-w-[140px]">
                            {pos.userName ?? pos.userEmail ?? 'Unknown'}
                          </p>
                          <p className="text-[11px] text-zinc-600 truncate max-w-[140px]">{pos.productName}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-mono font-semibold text-violet-400">{pos.principalTzs.toLocaleString()}</p>
                          <p className="text-[10px] text-zinc-600">TZS</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-mono font-semibold text-amber-400">+{pos.accruedYieldTzs.toLocaleString()}</p>
                          <p className="text-[10px] text-zinc-600">TZS</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                            {pos.annualRateBps / 100}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-600">
                          {pos.openedAt ? formatDateTimeEAT(pos.openedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <div className="space-y-6">
          {/* Daily accrual history */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Daily Yield Accruals
            </h2>
            <div className="overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.07]">
              {accrualHistory.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-600">No accruals recorded yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3 text-right">Total Accrued</th>
                      <th className="px-4 py-3 text-right">Positions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {accrualHistory.map((row) => (
                      <tr key={row.date} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-mono text-xs text-zinc-400">{row.date}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-emerald-400">
                          +{row.totalAccrued.toLocaleString()} TZS
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-zinc-600">{row.positionCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Recent transactions */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Recent Savings Transactions
            </h2>
            <div className="overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.07]">
              {recentTxns.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-600">No transactions yet.</div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {recentTxns.map((txn) => {
                    const isDeposit = txn.type === 'deposit'
                    return (
                      <div key={txn.id} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${isDeposit ? 'bg-emerald-500/12' : 'bg-rose-500/12'}`}>
                            <svg className={`h-3.5 w-3.5 ${isDeposit ? 'text-emerald-400' : 'text-rose-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              {isDeposit
                                ? <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                : <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                              }
                            </svg>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-white capitalize">{txn.type}</p>
                            <p className="text-[11px] text-zinc-600 truncate max-w-[120px]">
                              {txn.userName ?? txn.userEmail ?? 'Unknown'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-mono text-sm font-semibold ${isDeposit ? 'text-emerald-400' : 'text-rose-300'}`}>
                            {isDeposit ? '+' : '-'}{txn.amountTzs.toLocaleString()} TZS
                          </p>
                          <p className="text-[10px] text-zinc-600">
                            {txn.createdAt ? formatDateTimeEAT(txn.createdAt) : '—'}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
