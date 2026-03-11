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
import { TokenBalance } from './_components/TokenBalance'
import { DashboardActions } from './_components/DashboardActions'
import { formatDateEAT } from '@/lib/format-date'

export default async function UserDashboard() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const [wallet, recentDeposits, recentBurns] = await Promise.all([
    getCachedWallet(dbUser.id),
    getCachedRecentDeposits(dbUser.id, 5),
    getCachedRecentBurns(dbUser.id, 5),
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
    <div className="min-h-screen bg-[#0d0d14] px-4 py-6 lg:p-8">

      {/* ── Hero: Greeting + Balance ── */}
      <div className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-[#12121e] to-[#0f0f1a] p-6 ring-1 ring-white/[0.06]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:44px_44px]" />
        <div className="pointer-events-none absolute -top-16 right-0 h-48 w-64 rounded-full bg-blue-600/[0.07] blur-3xl" />

        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Welcome back</p>
            <h1 className="mt-1 text-xl font-bold text-white">
              {dbUser.payAlias ? `@${dbUser.payAlias}` : dbUser.email}
            </h1>
            <p className="mt-0.5 text-xs text-zinc-500">Here is a summary of your account</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-blue-600/15 px-3 py-2 ring-1 ring-blue-600/20">
            <IconWallet className="h-4 w-4 text-blue-400" />
            <div className="text-right">
              <p className="text-[10px] font-medium text-blue-400 uppercase tracking-wide">Balance</p>
              {wallet ? (
                <TokenBalance walletAddress={wallet.address} compact />
              ) : (
                <p className="text-sm font-bold text-white">0 TZS</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <DashboardActions />

      {/* ── Main Two-Column Grid ── */}
      <div className="grid gap-5 lg:grid-cols-5">

        {/* Left col: Recent Transactions (3/5 width) */}
        <div className="lg:col-span-3">
          <div className="overflow-hidden rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
              <h2 className="text-sm font-semibold text-white">Recent Transactions</h2>
              <Link
                href="/app/user/activity"
                prefetch
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
              >
                View all
                <IconChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {recentTxns.length === 0 ? (
                <div className="py-14 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04]">
                    <IconReceipt className="h-7 w-7 text-zinc-600" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-zinc-400">No transactions yet</p>
                  <p className="mt-1 text-xs text-zinc-600">Make your first deposit to get started</p>
                </div>
              ) : (
                recentTxns.map((tx) => {
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

                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-white/[0.03]"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          tx.type === 'deposit' ? 'bg-emerald-500/12' : 'bg-rose-500/12'
                        }`}>
                          {tx.type === 'deposit' ? (
                            <IconPlus className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <IconWithdraw className="h-4 w-4 text-rose-300" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{label}</p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            {tx.createdAt ? formatDateEAT(tx.createdAt) : ''}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-semibold font-mono ${tx.type === 'deposit' ? 'text-emerald-400' : 'text-rose-300'}`}>
                          {tx.type === 'deposit' ? '+' : '-'}{tx.amountTzs.toLocaleString()} TZS
                        </p>
                        <p className={`mt-0.5 text-xs capitalize ${statusColor}`}>
                          {String(tx.status).replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
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
  )
}
