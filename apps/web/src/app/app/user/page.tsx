import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import { getCachedRecentDeposits, getCachedRecentBurns } from '@/lib/user/cachedQueries'

import {
  IconCheckCircle,
  IconChevronRight,
  IconPlus,
  IconReceipt,
  IconSparkles,
  IconUsers,
  IconWallet,
  IconWithdraw,
} from '@/app/app/_components/icons'
import { DashboardActions } from './_components/DashboardActions'
import { DashboardHeroCard } from './_components/DashboardHeroCard'
import { ActivityDropdown } from '@/components/ui/activity-dropdown'
import { NewsCard } from '@/components/ui/news-card'
import { getNews } from '@/lib/news/getNews'
import { formatDateEAT } from '@/lib/format-date'

export default async function UserDashboard() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const [wallet, recentDeposits, recentBurns, newsArticles] = await Promise.all([
    getCachedWallet(dbUser.id),
    getCachedRecentDeposits(dbUser.id, 5),
    getCachedRecentBurns(dbUser.id, 5),
    getNews(),
  ])

  const recentTxns = [
    ...recentDeposits.map((d) => ({
      type: 'deposit' as const,
      source: (d as Record<string, unknown>).source as string | undefined,
      payerName: (d as Record<string, unknown>).payerName as string | undefined,
      id: d.id,
      amountTzs: d.amountTzs,
      status: d.status,
      createdAt: d.createdAt,
    })),
    ...recentBurns.map((b) => ({
      type: 'burn' as const,
      source: undefined as string | undefined,
      payerName: undefined as string | undefined,
      id: b.id,
      amountTzs: b.amountTzs,
      status: b.status,
      createdAt: b.createdAt,
    })),
  ]
    .filter((t) => t.createdAt)
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    .slice(0, 5)

  const pendingCount = recentDeposits.filter(d => !['minted', 'rejected', 'cancelled'].includes(d.status)).length

  return (
    <div className="bg-[#0d0d14]">

      {/* ── Sticky Header: Hero + Actions ── */}
      <div className="sticky top-14 z-20 bg-[#0d0d14] px-4 pt-3 pb-3 lg:top-0 lg:px-8 lg:pt-6 lg:pb-4">

        {/* Hero: Greeting + Balance */}
        <DashboardHeroCard
          payAlias={dbUser.payAlias ?? null}
          email={dbUser.email}
          walletAddress={wallet?.address ?? null}
        />

        {/* Action Buttons */}
        <DashboardActions />
      </div>

      {/* ── Scrollable Content ── */}
      <div className="px-4 pb-6 lg:px-8 lg:pb-8">

      {/* ── Main Two-Column Grid ── */}
      <div className="grid gap-5 lg:grid-cols-5">

        {/* Left col: Recent Transactions (3/5 width) */}
        <div className="lg:col-span-3">
          {recentTxns.length === 0 ? (
            <div className="overflow-hidden rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06]">
              <div className="py-14 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04]">
                  <IconReceipt className="h-7 w-7 text-zinc-600" />
                </div>
                <p className="mt-4 text-sm font-medium text-zinc-400">No transactions yet</p>
                <p className="mt-1 text-xs text-zinc-600">Make your first deposit to get started</p>
              </div>
            </div>
          ) : (
            <ActivityDropdown
              title="Recent Transactions"
              subtitle={`${recentTxns.length} recent activities`}
              activities={recentTxns.map((tx) => {
                const label =
                  tx.type === 'deposit'
                    ? tx.source === 'pay_link'
                      ? tx.payerName ? `Collection · ${tx.payerName}` : 'Collection'
                      : 'Deposit'
                    : 'Withdraw'

                const statusColor =
                  tx.type === 'deposit'
                    ? tx.status === 'minted' ? 'text-emerald-400'
                      : tx.status === 'rejected' || tx.status === 'cancelled' ? 'text-rose-400'
                      : 'text-amber-400'
                    : tx.status === 'burned' ? 'text-rose-300'
                      : tx.status === 'failed' ? 'text-rose-400'
                      : 'text-amber-400'

                return {
                  id: tx.id,
                  icon: tx.type === 'deposit' ? (
                    <IconPlus className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <IconWithdraw className="h-4 w-4 text-rose-300" />
                  ),
                  label,
                  amount: tx.amountTzs,
                  status: String(tx.status).replace(/_/g, ' '),
                  date: tx.createdAt ? formatDateEAT(tx.createdAt) : '',
                  statusColor,
                  isDeposit: tx.type === 'deposit',
                }
              })}
            />
          )}

          {/* Market & News */}
          {newsArticles.length > 0 && (
            <div className="mt-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Market &amp; News</p>
                <div className="flex items-center gap-2">
                  <a href="https://www.thecitizen.co.tz/tanzania/news/national" target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">The Citizen</a>
                  <span className="text-zinc-700">·</span>
                  <a href="https://dse.co.tz/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">DSE</a>
                </div>
              </div>
              <div
                className="flex gap-3 overflow-x-auto pb-3"
                style={{ scrollbarWidth: 'none' as const, WebkitOverflowScrolling: 'touch' }}
              >
                {newsArticles.map((article, i) => (
                  <NewsCard key={`${article.source}-${i}`} article={article} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right col: Quick Links (2/5 width) */}
        <div className="hidden lg:flex lg:col-span-2 lg:flex-col lg:gap-4">

          {/* Quick Links card */}
          <div className="rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.05]">
              <p className="text-sm font-semibold text-white">Quick Links</p>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {[
                {
                  href: '/app/user/wallet',
                  icon: IconWallet,
                  label: 'My Wallet',
                  sub: 'Balance and transaction history',
                },
                {
                  href: '/app/user/deposits/new',
                  icon: IconPlus,
                  label: 'Deposit',
                  sub: 'Add funds to your wallet',
                },
                {
                  href: '/app/user/activity',
                  icon: IconReceipt,
                  label: 'Activity',
                  sub: 'View all transactions',
                },
                {
                  href: '/app/user/invite',
                  icon: IconUsers,
                  label: 'Invite a Friend',
                  sub: 'Earn 5,000 TZS bonus',
                },
                {
                  href: '/app/user/stake',
                  icon: IconSparkles,
                  label: 'Stake to Earn',
                  sub: 'Up to 8% APY',
                },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.04] group"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05]">
                      <item.icon className="h-4 w-4 text-zinc-400 group-hover:text-orange-400 transition-colors" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white">{item.label}</p>
                      <p className="text-[11px] text-zinc-600">{item.sub}</p>
                    </div>
                  </div>
                  <IconChevronRight className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                </Link>
              ))}
            </div>
          </div>

          {/* Wallet address card */}
          {wallet && (
            <div className="rounded-2xl bg-[#12121e] p-5 ring-1 ring-white/[0.06]">
              <div className="flex items-center gap-2 mb-3">
                <IconWallet className="h-4 w-4 text-blue-400" />
                <p className="text-xs font-semibold text-white">Wallet</p>
                <span className="ml-auto text-[10px] text-zinc-600">Base network</span>
              </div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 mb-1">Address</p>
              <p className="truncate font-mono text-xs text-zinc-400">{wallet.address}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-zinc-600">Status</span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <IconCheckCircle className="h-3 w-3" />
                  Active
                </span>
              </div>
              {pendingCount > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-zinc-600">Pending deposits</span>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                    {pendingCount}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
