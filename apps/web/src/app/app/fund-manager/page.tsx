import { desc, eq, sql, and } from 'drizzle-orm'
import { redirect } from 'next/navigation'

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

export default async function FundManagerDashboard() {
  const dbUser = await requireAnyRole(['fund_manager', 'super_admin'])
  const { db } = getDb()

  // Resolve which fund manager this user is linked to
  // super_admin sees all (fundManagerId = null means aggregate view)
  const linkedFmId = (dbUser as { fundManagerId?: string | null }).fundManagerId ?? null
  const isSuperAdmin = dbUser.role === 'super_admin'

  // If fund_manager role but no linked fund manager record, show error
  if (dbUser.role === 'fund_manager' && !linkedFmId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0d14]">
        <div className="max-w-sm text-center">
          <div className="mb-4 mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
            <svg className="h-7 w-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-white">Account not linked</p>
          <p className="mt-1 text-xs text-zinc-500">
            Your account has not been linked to a fund manager record. Contact a super admin.
          </p>
        </div>
      </div>
    )
  }

  // ── Fetch fund manager record ─────────────────────────────────────────────
  let fm: { id: string; name: string; status: string; tvlLimitTzs: number | null; licenseNumber: string | null; notes: string | null } | null = null

  if (linkedFmId) {
    const [row] = await db
      .select({
        id: fundManagers.id,
        name: fundManagers.name,
        status: fundManagers.status,
        tvlLimitTzs: fundManagers.tvlLimitTzs,
        licenseNumber: fundManagers.licenseNumber,
        notes: fundManagers.notes,
      })
      .from(fundManagers)
      .where(eq(fundManagers.id, linkedFmId))
      .limit(1)
    fm = row ?? null
  }

  // ── Summary aggregates (scoped to this FM) ────────────────────────────────
  const positionsQuery = db
    .select({
      totalTvl: sql<number>`coalesce(sum(case when ${savingsPositions.status} = 'active' then ${savingsPositions.principalTzs} else 0 end), 0)`.mapWith(Number),
      totalYieldOwed: sql<number>`coalesce(sum(case when ${savingsPositions.status} = 'active' then ${savingsPositions.accruedYieldTzs} else 0 end), 0)`.mapWith(Number),
      totalDepositedAllTime: sql<number>`coalesce(sum(${savingsPositions.totalDepositedTzs}), 0)`.mapWith(Number),
      totalWithdrawnAllTime: sql<number>`coalesce(sum(${savingsPositions.totalWithdrawnTzs}), 0)`.mapWith(Number),
      activeSavers: sql<number>`count(case when ${savingsPositions.status} = 'active' and ${savingsPositions.principalTzs} > 0 then 1 end)`.mapWith(Number),
    })
    .from(savingsPositions)
    .innerJoin(savingsProducts, eq(savingsProducts.id, savingsPositions.productId))

  const [summary] = linkedFmId
    ? await positionsQuery.where(eq(savingsProducts.fundManagerId, linkedFmId))
    : await positionsQuery

  const netExposure = (summary?.totalTvl ?? 0) + (summary?.totalYieldOwed ?? 0)

  // ── Products this FM manages ──────────────────────────────────────────────
  const productsBase = db
    .select({
      id: savingsProducts.id,
      name: savingsProducts.name,
      annualRateBps: savingsProducts.annualRateBps,
      lockDays: savingsProducts.lockDays,
      minDepositTzs: savingsProducts.minDepositTzs,
      maxDepositTzs: savingsProducts.maxDepositTzs,
      status: savingsProducts.status,
      tvl: sql<number>`coalesce(sum(case when ${savingsPositions.status} = 'active' then ${savingsPositions.principalTzs} else 0 end), 0)`.mapWith(Number),
      savers: sql<number>`count(case when ${savingsPositions.status} = 'active' and ${savingsPositions.principalTzs} > 0 then 1 end)`.mapWith(Number),
      yieldOwed: sql<number>`coalesce(sum(case when ${savingsPositions.status} = 'active' then ${savingsPositions.accruedYieldTzs} else 0 end), 0)`.mapWith(Number),
    })
    .from(savingsProducts)
    .leftJoin(savingsPositions, eq(savingsPositions.productId, savingsProducts.id))
    .groupBy(savingsProducts.id)

  const products = linkedFmId
    ? await productsBase.where(eq(savingsProducts.fundManagerId, linkedFmId))
    : await productsBase

  // ── Active positions (top 50 by principal) ────────────────────────────────
  const positionsDetailBase = db
    .select({
      id: savingsPositions.id,
      principalTzs: savingsPositions.principalTzs,
      accruedYieldTzs: savingsPositions.accruedYieldTzs,
      annualRateBps: savingsPositions.annualRateBps,
      openedAt: savingsPositions.openedAt,
      userEmail: users.email,
      userName: users.name,
      productName: savingsProducts.name,
    })
    .from(savingsPositions)
    .leftJoin(users, eq(users.id, savingsPositions.userId))
    .leftJoin(savingsProducts, eq(savingsProducts.id, savingsPositions.productId))
    .orderBy(desc(savingsPositions.principalTzs))
    .limit(50)

  const positionsDetail = linkedFmId
    ? await positionsDetailBase.where(
        and(eq(savingsPositions.status, 'active'), eq(savingsProducts.fundManagerId, linkedFmId)),
      )
    : await positionsDetailBase.where(eq(savingsPositions.status, 'active'))

  // ── Daily accrual history (last 21 days, scoped) ──────────────────────────
  const accrualBase = db
    .select({
      date: yieldAccruals.date,
      totalAccrued: sql<number>`sum(${yieldAccruals.accruedTzs})`.mapWith(Number),
      positionCount: sql<number>`count(distinct ${yieldAccruals.positionId})`.mapWith(Number),
    })
    .from(yieldAccruals)
    .innerJoin(savingsPositions, eq(savingsPositions.id, yieldAccruals.positionId))
    .innerJoin(savingsProducts, eq(savingsProducts.id, savingsPositions.productId))
    .groupBy(yieldAccruals.date)
    .orderBy(desc(yieldAccruals.date))
    .limit(21)

  const accrualHistory = linkedFmId
    ? await accrualBase.where(eq(savingsProducts.fundManagerId, linkedFmId))
    : await accrualBase

  // ── Recent transactions (last 30) ─────────────────────────────────────────
  const txnBase = db
    .select({
      id: savingsTransactions.id,
      type: savingsTransactions.type,
      amountTzs: savingsTransactions.amountTzs,
      createdAt: savingsTransactions.createdAt,
      userEmail: users.email,
      userName: users.name,
      productName: savingsProducts.name,
    })
    .from(savingsTransactions)
    .leftJoin(users, eq(users.id, savingsTransactions.userId))
    .leftJoin(savingsPositions, eq(savingsPositions.id, savingsTransactions.positionId))
    .leftJoin(savingsProducts, eq(savingsProducts.id, savingsPositions.productId))
    .orderBy(desc(savingsTransactions.createdAt))
    .limit(30)

  const recentTxns = linkedFmId
    ? await txnBase.where(eq(savingsProducts.fundManagerId, linkedFmId))
    : await txnBase

  const utilizationPct =
    fm?.tvlLimitTzs && fm.tvlLimitTzs > 0
      ? Math.min(100, Math.round(((summary?.totalTvl ?? 0) / fm.tvlLimitTzs) * 100))
      : null

  return (
    <div className="min-h-screen bg-[#0d0d14] px-4 pb-24 pt-6 lg:px-8">

      {/* Header */}
      <div className="mb-7 flex items-start justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 ring-1 ring-violet-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-400">
              Fund Manager Portal
            </span>
          </div>
          <h1 className="text-xl font-bold text-white">
            {fm ? fm.name : 'All Fund Managers'}
          </h1>
          {fm?.licenseNumber && (
            <p className="mt-0.5 text-xs text-zinc-600">License: {fm.licenseNumber}</p>
          )}
        </div>
        <div className="rounded-xl bg-white/[0.04] px-3 py-1.5 ring-1 ring-white/[0.07]">
          <p className="text-[11px] font-medium text-zinc-500">Updated {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          { label: 'Total TVL', value: (summary?.totalTvl ?? 0).toLocaleString(), sub: 'TZS under management', color: 'text-violet-400' },
          { label: 'Yield Owed', value: (summary?.totalYieldOwed ?? 0).toLocaleString(), sub: 'Accrued, pending settlement', color: 'text-amber-400' },
          { label: 'Net Exposure', value: netExposure.toLocaleString(), sub: 'Total liability to savers', color: 'text-rose-400' },
          { label: 'Active Savers', value: String(summary?.activeSavers ?? 0), sub: 'Positions with balance', color: 'text-blue-400' },
          { label: 'Total Deposited', value: (summary?.totalDepositedAllTime ?? 0).toLocaleString(), sub: 'All time inflows', color: 'text-emerald-400' },
          { label: 'Total Withdrawn', value: (summary?.totalWithdrawnAllTime ?? 0).toLocaleString(), sub: 'All time outflows', color: 'text-zinc-300' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="rounded-2xl bg-[#12121e] p-4 ring-1 ring-white/[0.06]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{label}</p>
            <p className={`mt-2 font-mono text-xl font-bold ${color}`}>{value}</p>
            <p className="mt-0.5 text-[10px] text-zinc-600">{sub}</p>
          </div>
        ))}
      </div>

      {/* TVL utilization bar */}
      {fm?.tvlLimitTzs && utilizationPct !== null && (
        <div className="mb-6 rounded-2xl bg-[#12121e] p-4 ring-1 ring-white/[0.06]">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-zinc-500">TVL utilization</span>
            <span className={`font-semibold ${utilizationPct >= 90 ? 'text-rose-400' : utilizationPct >= 70 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {utilizationPct}% of {fm.tvlLimitTzs.toLocaleString()} TZS limit
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`h-full rounded-full transition-all ${utilizationPct >= 90 ? 'bg-rose-500' : utilizationPct >= 70 ? 'bg-amber-400' : 'bg-violet-500'}`}
              style={{ width: `${utilizationPct}%` }}
            />
          </div>
          {utilizationPct >= 90 && (
            <p className="mt-2 text-[11px] text-rose-400">Approaching TVL limit — contact operations.</p>
          )}
        </div>
      )}

      {/* Products */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">
          Savings Products
        </h2>
        <div className="space-y-2">
          {products.length === 0 ? (
            <div className="rounded-2xl bg-[#12121e] p-8 text-center ring-1 ring-white/[0.06]">
              <p className="text-sm text-zinc-600">No products configured.</p>
            </div>
          ) : (
            products.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-2xl bg-[#12121e] px-4 py-4 ring-1 ring-white/[0.06]">
                <div className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${p.status === 'active' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  <div>
                    <p className="text-sm font-semibold text-white">{p.name}</p>
                    <p className="text-xs text-zinc-600">
                      {p.annualRateBps / 100}% p.a.
                      {p.lockDays > 0 ? ` · ${p.lockDays}-day lock` : ' · Open-ended'}
                      {p.minDepositTzs > 0 ? ` · Min ${p.minDepositTzs.toLocaleString()} TZS` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="font-mono text-sm font-bold text-violet-400">{p.tvl.toLocaleString()}</p>
                    <p className="text-[10px] text-zinc-600">TZS TVL</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-300">{p.savers}</p>
                    <p className="text-[10px] text-zinc-600">savers</p>
                  </div>
                  <div>
                    <p className="font-mono text-sm font-bold text-amber-400">+{p.yieldOwed.toLocaleString()}</p>
                    <p className="text-[10px] text-zinc-600">yield owed</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Active positions */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">
            Active Positions ({positionsDetail.length})
          </h2>
          <div className="overflow-hidden rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06]">
            {positionsDetail.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-600">No active positions yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.05] text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                      <th className="px-4 py-3">Saver</th>
                      <th className="px-4 py-3 text-right">Principal</th>
                      <th className="px-4 py-3 text-right">Yield</th>
                      <th className="px-4 py-3">Opened</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {positionsDetail.map((pos) => (
                      <tr key={pos.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <p className="max-w-[130px] truncate font-medium text-white">
                            {pos.userName ?? pos.userEmail ?? 'Unknown'}
                          </p>
                          <p className="max-w-[130px] truncate text-[11px] text-zinc-600">{pos.productName}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-mono font-semibold text-violet-400">{pos.principalTzs.toLocaleString()}</p>
                          <p className="text-[10px] text-zinc-600">TZS</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-mono font-semibold text-amber-400">+{pos.accruedYieldTzs.toLocaleString()}</p>
                          <p className="text-[10px] text-zinc-600">TZS</p>
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

        <div className="space-y-5">
          {/* Daily accrual history */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Daily Yield Accruals
            </h2>
            <div className="overflow-hidden rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06]">
              {accrualHistory.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-600">No accruals yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.05] text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3 text-right">Accrued</th>
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
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Recent Transactions
            </h2>
            <div className="overflow-hidden rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06]">
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
                            <p className="text-xs font-medium capitalize text-white">{txn.type}</p>
                            <p className="max-w-[120px] truncate text-[11px] text-zinc-600">
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
