import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import { getCachedRecentDeposits, getCachedRecentBurns } from '@/lib/user/cachedQueries'

import {
  IconCheckCircle,
  IconChevronRight,
  IconPlus,
  IconReceipt,
  IconSend,
  IconSparkles,
  IconUsers,
  IconWallet,
  IconWithdraw,
} from '@/app/app/_components/icons'
import { TokenBalance } from './_components/TokenBalance'
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
    <div className="min-h-screen bg-[#0a0a0f] px-4 py-6 lg:p-8">

      {/* ── Balance Hero Card ── */}
      <div className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[#111827] via-[#0f172a] to-[#111827] p-6 ring-1 ring-white/[0.07]">
        {/* subtle grid overlay */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px]" />
        {/* glow */}
        <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-80 -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl" />

        <div className="relative">
          <p className="text-xs font-medium tracking-widest text-zinc-500 uppercase">Welcome back</p>
          <h1 className="mt-1 text-lg font-semibold text-white">
            {dbUser.payAlias ? `@${dbUser.payAlias}` : dbUser.email}
          </h1>

          <div className="mt-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-zinc-500">Total Balance</span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-400 ring-1 ring-emerald-500/20">
                nTZS
              </span>
            </div>
            {wallet ? (
              <TokenBalance walletAddress={wallet.address} />
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold tracking-tight text-white">0.00</span>
                  <span className="text-xl font-light text-zinc-500">TZS</span>
                </div>
                <p className="mt-2 text-sm text-zinc-600">≈ $0.00 USD</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Link
          href="/app/user/deposits/new"
          prefetch
          className="group flex flex-col items-center gap-2 rounded-2xl bg-white px-3 py-4 text-xs font-semibold text-black transition-all duration-150 hover:bg-zinc-100 active:scale-95"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/8 transition-colors group-hover:bg-black/12">
            <IconPlus className="h-5 w-5" />
          </div>
          Deposit
        </Link>

        <button
          disabled
          className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-4 text-xs font-medium text-white/40 cursor-not-allowed"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/8">
            <IconSend className="h-5 w-5" />
          </div>
          Send
        </button>

        <Link
          href="/app/user/wallet"
          prefetch
          className="group flex flex-col items-center gap-2 rounded-2xl bg-blue-600 px-3 py-4 text-xs font-semibold text-white transition-all duration-150 hover:bg-blue-500 active:scale-95"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 transition-colors group-hover:bg-white/25">
            <IconWallet className="h-5 w-5" />
          </div>
          Pay Me
        </Link>
      </div>

      {/* ── Main Grid ── */}
      <div className="grid gap-5 lg:grid-cols-3">

        {/* Left: Transactions */}
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-2xl bg-[#111218] ring-1 ring-white/[0.07]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
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
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                            tx.type === 'deposit' ? 'bg-emerald-500/10' : 'bg-rose-500/10'
                          }`}
                        >
                          {tx.type === 'deposit' ? (
                            <IconPlus className="h-4.5 w-4.5 text-emerald-400" />
                          ) : (
                            <IconWithdraw className="h-4.5 w-4.5 text-rose-300" />
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

        {/* Right: Cards */}
        <div className="hidden lg:flex lg:flex-col lg:gap-4">

          {/* Wallet Card */}
          <div className="rounded-2xl bg-[#111218] p-5 ring-1 ring-white/[0.07]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/15">
                <IconWallet className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Wallet</p>
                <p className="text-xs text-zinc-500">Base network</p>
              </div>
            </div>
            {wallet ? (
              <Link
                href="/app/user/wallet"
                prefetch
                className="mt-4 block rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.07]"
              >
                <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Address</p>
                <p className="mt-1 truncate font-mono text-xs text-zinc-300">{wallet.address}</p>
              </Link>
            ) : null}
          </div>

          {/* Rewards Card */}
          <div className="rounded-2xl bg-[#111218] p-5 ring-1 ring-white/[0.07]">
            <p className="text-sm font-semibold text-white">Rewards</p>
            <p className="mt-0.5 text-xs text-zinc-500">Earn more with nTZS</p>

            <div className="mt-4 space-y-2">
              <Link
                href="/app/user/invite"
                prefetch
                className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3 transition-all hover:bg-white/[0.08] active:scale-[0.98]"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
                  <IconUsers className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white">Invite a friend</p>
                  <p className="text-[11px] text-zinc-500">Earn 5,000 TZS bonus</p>
                </div>
                <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              </Link>

              <Link
                href="/app/user/stake"
                prefetch
                className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3 transition-all hover:bg-white/[0.08] active:scale-[0.98]"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15">
                  <IconSparkles className="h-4 w-4 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white">Stake to Earn</p>
                  <p className="text-[11px] text-zinc-500">Up to 8% APY</p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                  NEW
                </span>
              </Link>
            </div>
          </div>

          {/* Account Status Card */}
          <div className="rounded-2xl bg-[#111218] p-5 ring-1 ring-white/[0.07]">
            <p className="text-sm font-semibold text-white">Account Status</p>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Pending Deposits</span>
                <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-white">
                  {pendingCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Wallet</span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <IconCheckCircle className="h-3.5 w-3.5" />
                  Active
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
