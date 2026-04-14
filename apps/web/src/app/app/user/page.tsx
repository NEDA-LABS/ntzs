import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import { getCachedRecentDeposits, getCachedRecentBurns, getCachedApprovedKyc } from '@/lib/user/cachedQueries'

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
import { CompressedHeroStrip } from './_components/CompressedHeroStrip'
import { PendingDepositPoller } from './_components/PendingDepositPoller'
import { ActivityDropdown } from '@/components/ui/activity-dropdown'
import { formatDateEAT } from '@/lib/format-date'
import { AssistantBar } from './_components/AssistantBar'
import { QuickIntentsGrid } from './_components/QuickIntentsGrid'
import { ContextChips } from './_components/ContextChips'

export default async function UserDashboard() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const [wallet, recentDeposits, recentBurns, approvedKyc] = await Promise.all([
    getCachedWallet(dbUser.id),
    getCachedRecentDeposits(dbUser.id, 5),
    getCachedRecentBurns(dbUser.id, 5),
    getCachedApprovedKyc(dbUser.id),
  ])

  const kycApproved = approvedKyc.length > 0

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
      <PendingDepositPoller hasPending={pendingCount > 0} />

      {/* ── KYC Prompt Banner ── */}
      {!kycApproved && (
        <div className="mx-4 mt-4 lg:mx-8 lg:mt-6">
          <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(245,158,11,0.08),transparent_60%)]" />
            <div className="relative flex items-start gap-3 sm:items-center">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 ring-1 ring-amber-500/30">
                <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-300">Verify your identity to start depositing</p>
                <p className="mt-0.5 text-xs text-amber-400/70">Submit your national ID — takes less than a minute and unlocks deposits instantly.</p>
              </div>
              <Link
                href="/app/user/kyc"
                className="shrink-0 rounded-xl bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-300 ring-1 ring-amber-500/30 transition-colors hover:bg-amber-500/30"
              >
                Submit ID →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Hero + Actions — scrolls away on mobile ── */}
      <div className="px-4 pt-3 pb-3 lg:px-8 lg:pt-6 lg:pb-4">
        <DashboardHeroCard
          payAlias={dbUser.payAlias ?? null}
          email={dbUser.email}
          walletAddress={wallet?.address ?? null}
        />
        <DashboardActions />
      </div>

      {/* ── Compressed hero strip — slides in on mobile when hero scrolls away ── */}
      <CompressedHeroStrip
        displayName={dbUser.payAlias ?? dbUser.email.split('@')[0]}
      />

      {/* ── Scrollable Content ── */}
      <div className="px-4 pb-6 lg:px-8 lg:pb-8">

      {/* ── Main Two-Column Grid ── */}
      <div className="grid gap-5 lg:grid-cols-5">

        {/* Left col: Recent Transactions (3/5 width) */}
        <div className="min-w-0 lg:col-span-3">
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

          {/* Assistant Section */}
          <div className="mt-6 space-y-4">
            <ContextChips walletAddress={wallet?.address ?? null} kycApproved={kycApproved} pendingCount={pendingCount} />
            <AssistantBar />
            <QuickIntentsGrid />
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
    </div>
  )
}
