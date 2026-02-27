import Link from 'next/link'
import { eq, desc } from 'drizzle-orm'

import { requireAnyRole, requireDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { wallets, depositRequests, burnRequests } from '@ntzs/db'

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

export default async function UserDashboard() {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()
  const { db } = getDb()

  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, dbUser.id),
  })

  const recentDeposits = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.userId, dbUser.id))
    .orderBy(desc(depositRequests.createdAt))
    .limit(5)

  const recentBurns = await db
    .select({
      id: burnRequests.id,
      amountTzs: burnRequests.amountTzs,
      status: burnRequests.status,
      createdAt: burnRequests.createdAt,
    })
    .from(burnRequests)
    .where(eq(burnRequests.userId, dbUser.id))
    .orderBy(desc(burnRequests.createdAt))
    .limit(5)

  const recentTxns = [
    ...recentDeposits.map((d) => ({
      type: 'deposit' as const,
      id: d.id,
      amountTzs: d.amountTzs,
      status: d.status,
      createdAt: d.createdAt,
    })),
    ...recentBurns.map((b) => ({
      type: 'burn' as const,
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
    <div className="p-8">
      <div className="mb-6">
        <p className="text-sm text-zinc-400">Welcome back</p>
        <h1 className="mt-1 text-xl font-semibold text-white">{dbUser.email}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Balance Card */}
          <div className="lg:col-span-2">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(121,40,202,0.18),transparent_45%),radial-gradient(circle_at_80%_100%,rgba(0,112,243,0.12),transparent_45%)]" />

              <div className="relative">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-400">Total Balance</span>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                    nTZS
                  </span>
                </div>
                
                <div className="mt-4">
                  {wallet ? (
                    <TokenBalance walletAddress={wallet.address} />
                  ) : (
                    <>
                      <div className="flex items-baseline gap-3">
                        <span className="text-5xl font-bold tracking-tight text-white">0.00</span>
                        <span className="text-lg text-zinc-500">TZS</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-sm">
                        <span className="text-zinc-500">≈ $0.00 USD</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Quick Actions */}
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/app/user/deposits/new"
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition-transform duration-75 hover:bg-white/90 active:scale-95 active:bg-white/80"
                  >
                    <IconPlus className="h-4 w-4" />
                    Deposit
                  </Link>
                  <button
                    disabled
                    className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-medium text-white/60 cursor-not-allowed"
                  >
                    <IconSend className="h-4 w-4" />
                    Send
                  </button>
                  <Link
                    href="/app/user/withdraw"
                    className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-medium text-white transition-transform duration-75 hover:bg-white/10 active:scale-95"
                  >
                    <IconWithdraw className="h-4 w-4" />
                    Withdraw
                  </Link>
                </div>
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                <h2 className="font-semibold text-white">Recent Transactions</h2>
                <Link
                  href="/app/user/activity"
                  className="inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300"
                >
                  View all
                  <IconChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="p-4">
                {recentTxns.length === 0 ? (
                  <div className="py-8 text-center">
                    <IconReceipt className="mx-auto h-12 w-12 text-zinc-700" />
                    <p className="mt-4 text-sm text-zinc-500">No transactions yet</p>
                    <p className="mt-1 text-xs text-zinc-600">Make your first deposit to get started</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentTxns.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between rounded-xl bg-white/5 p-4 transition-colors hover:bg-white/[0.07]">
                        <div className="flex items-center gap-4">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-full ${
                              tx.type === 'deposit' ? 'bg-emerald-500/10' : 'bg-rose-500/10'
                            }`}
                          >
                            {tx.type === 'deposit' ? (
                              <IconPlus className="h-5 w-5 text-emerald-400" />
                            ) : (
                              <IconWithdraw className="h-5 w-5 text-rose-300" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-white">{tx.type === 'deposit' ? 'Deposit' : 'Withdraw'}</p>
                            <p className="text-xs text-zinc-500">
                              {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : ''}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {tx.type === 'deposit' ? (
                            <p className="font-mono font-medium text-emerald-400">+{tx.amountTzs.toLocaleString()} TZS</p>
                          ) : (
                            <p className="font-mono font-medium text-rose-300">-{tx.amountTzs.toLocaleString()} TZS</p>
                          )}
                          <p
                            className={`text-xs capitalize ${
                              tx.type === 'deposit'
                                ? tx.status === 'minted'
                                  ? 'text-emerald-400'
                                  : tx.status === 'rejected'
                                    ? 'text-rose-400'
                                    : 'text-amber-400'
                                : tx.status === 'burned'
                                  ? 'text-rose-300'
                                  : tx.status === 'failed'
                                    ? 'text-rose-400'
                                    : 'text-amber-400'
                            }`}
                          >
                            {String(tx.status).replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Wallet Card */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${wallet ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                  <IconWallet className={`h-6 w-6 ${wallet ? 'text-emerald-400' : 'text-amber-400'}`} />
                </div>
                <div>
                  <p className="font-semibold text-white">{wallet ? 'Wallet Ready' : 'Setup Wallet'}</p>
                  <p className="text-xs text-zinc-500">
                    {wallet ? 'Secure & recoverable' : 'Required for deposits'}
                  </p>
                </div>
              </div>
              {wallet ? (
                <div className="mt-4 rounded-xl bg-white/5 p-3">
                  <p className="text-xs text-zinc-500">Address</p>
                  <p className="mt-1 truncate font-mono text-sm text-white">{wallet.address}</p>
                </div>
              ) : (
                <Link
                  href="/app/user/wallet"
                  className="mt-4 block w-full rounded-xl bg-violet-500 py-3 text-center text-sm font-semibold text-white transition-transform duration-75 hover:bg-violet-600 active:scale-[0.98]"
                >
                  Create Wallet
                </Link>
              )}
            </div>

            {/* Rewards Card */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
              <h3 className="font-semibold text-white">Rewards</h3>
              <p className="mt-1 text-xs text-zinc-500">Earn more with nTZS</p>

              <div className="mt-4 space-y-3">
                <Link href="/app/user/invite" className="flex items-center gap-3 rounded-xl bg-white/5 p-3 transition-all duration-75 hover:bg-white/10 active:scale-[0.98] active:bg-white/[0.07]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20">
                    <IconUsers className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Invite a friend</p>
                    <p className="text-xs text-zinc-500">Earn 5,000 TZS bonus</p>
                  </div>
                  <IconChevronRight className="h-4 w-4 text-zinc-600" />
                </Link>

                <Link href="/app/user/stake" className="flex items-center gap-3 rounded-xl bg-white/5 p-3 transition-all duration-75 hover:bg-white/10 active:scale-[0.98] active:bg-white/[0.07]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20">
                    <IconSparkles className="h-4 w-4 text-violet-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Stake to Earn</p>
                    <p className="text-xs text-zinc-500">Up to 8% APY</p>
                  </div>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                    NEW
                  </span>
                </Link>
              </div>
            </div>

            {/* Status Card */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
              <h3 className="font-semibold text-white">Account Status</h3>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">KYC Verified</span>
                  <span className="flex items-center gap-1 text-sm text-emerald-400">
                    <IconCheckCircle className="h-4 w-4" />
                    Complete
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Pending Deposits</span>
                  <span className="text-sm text-white">{pendingCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Wallet Status</span>
                  <span className={`text-sm ${wallet ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {wallet ? 'Active' : 'Not Setup'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  )
}
