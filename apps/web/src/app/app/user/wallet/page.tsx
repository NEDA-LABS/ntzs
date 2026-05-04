import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import {
  IconChevronRight,
  IconPlus,
  IconReceipt,
  IconSparkles,
  IconUsers,
  IconWallet,
  IconCheckCircle,
} from '@/app/app/_components/icons'
import { PayMeSection } from './PayMeSection'
import { SendModal } from './SendModal'
import { SwapSection } from './SwapSection'
import { SwapHistory } from './SwapHistory'
import { TopActions } from './_components/TopActions'
import { ActionQueryBridge } from './ActionQueryBridge'
import { WithdrawInline } from './WithdrawInline'
import { BalanceToggle } from '../_components/BalanceToggle'

export default async function WalletPage() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const wallet = await getCachedWallet(dbUser.id)

  if (!wallet) {
    redirect('/app/user')
  }

  const suggestedAlias = dbUser.email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30) || 'user'

  const quickLinks = [
    { href: '/app/user', icon: IconWallet, label: 'Dashboard', sub: 'Back to overview' },
    { href: '/app/user/deposits/new', icon: IconPlus, label: 'Deposit', sub: 'Add funds to your wallet' },
    { href: '/app/user/activity', icon: IconReceipt, label: 'Activity', sub: 'View all transactions' },
    { href: '/app/user/invite', icon: IconUsers, label: 'Invite a Friend', sub: 'Earn 5,000 TZS bonus' },
    { href: '/app/user/stake', icon: IconSparkles, label: 'Stake to Earn', sub: 'Up to 8% APY' },
  ]

  return (
    <div className="ntzs-wallet-shell min-h-screen px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl space-y-5">

        {/* ── Nilipe card + Action buttons ── */}
        <div className="space-y-3">
          <div id="receive">
            <PayMeSection
              currentAlias={dbUser.payAlias ?? null}
              suggestedAlias={suggestedAlias}
              walletAddress={wallet.address}
            />
          </div>
          <TopActions />
          <ActionQueryBridge />
        </div>

        {/* ── Main two-column grid ── */}
        <div className="grid gap-5 lg:grid-cols-5">

          {/* Left col: Swap history (3/5 width) */}
          <div className="min-w-0 lg:col-span-3">
            <div className="overflow-hidden rounded-[28px] border border-border/40 bg-card/60 p-5 backdrop-blur-2xl">
              <SwapHistory />
            </div>
          </div>

          {/* Right col: Balance + Quick links (2/5 width) */}
          <div className="flex flex-col gap-4 lg:col-span-2">

            {/* Balance card with token tabs */}
            <div className="overflow-hidden rounded-[28px] border border-border/40 bg-card/60 p-5 backdrop-blur-2xl">
              <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Balances
              </p>
              <BalanceToggle walletAddress={wallet.address} />
            </div>

            {/* Quick links card */}
            <div className="overflow-hidden rounded-[28px] border border-border/40 bg-card/60 backdrop-blur-2xl">
              <div className="border-b border-border/40 px-5 py-4">
                <p className="text-sm font-semibold text-foreground">Quick Links</p>
              </div>
              <div className="divide-y divide-border/40">
                {quickLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    className="group flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-background/35"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/40 bg-background/40">
                        <item.icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground">{item.label}</p>
                        <p className="text-[11px] text-muted-foreground">{item.sub}</p>
                      </div>
                    </div>
                    <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground/80" />
                  </Link>
                ))}
              </div>
            </div>

            {/* Wallet address info card */}
            <div className="rounded-[28px] border border-border/40 bg-card/60 p-5 backdrop-blur-2xl">
              <div className="mb-3 flex items-center gap-2">
                <IconWallet className="h-4 w-4 text-primary" />
                <p className="text-xs font-semibold text-foreground">Wallet</p>
                <span className="ml-auto text-[10px] text-muted-foreground">Base network</span>
              </div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Address</p>
              <p className="truncate font-mono text-xs text-foreground/80">{wallet.address}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Status</span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <IconCheckCircle className="h-3 w-3" />
                  Active
                </span>
              </div>
            </div>

          </div>
        </div>

        {/* Modal instances — opened via TopActions events */}
        <SwapSection renderLauncher={false} />
        <SendModal walletAddress={wallet.address} />
        <WithdrawInline userPhone={dbUser.phone} />
      </div>
    </div>
  )
}
