import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireAnyRole } from '@/lib/auth/rbac'
import { GlassCard } from '@/components/ui/glass-card'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import { BalanceToggle } from '../_components/BalanceToggle'
import { PayMeSection } from './PayMeSection'
import { SendSection } from './SendSection'
import { SwapSection } from './SwapSection'
import { SwapHistory } from './SwapHistory'

export default async function WalletPage() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const wallet = await getCachedWallet(dbUser.id)

  // Layout auto-provisions the wallet — redirect back if still missing
  if (!wallet) {
    redirect('/app/user')
  }

  // Suggest an alias from the email prefix (e.g. "victor" from "victor@email.com")
  const suggestedAlias = dbUser.email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30) || 'user'

  const displayName = dbUser.payAlias ? `@${dbUser.payAlias}` : dbUser.email

  const shortAddress = `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}`

  return (
    <div className="ntzs-wallet-shell min-h-screen px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <GlassCard className="rounded-[32px]">
          <div className="absolute inset-0 ntzs-wallet-glow" />
          <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8">
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="inline-flex items-center rounded-full border border-border/50 bg-background/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground backdrop-blur">
                  Wallet overview
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Base network wallet</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
                      {displayName}
                    </h1>
                  </div>
                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
                    Manage your TZS balance, receive payments, send funds to aliases or addresses, and swap between nTZS and USDC from one wallet surface.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/app/user/deposits/new"
                  prefetch
                  className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-8 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Add funds
                </Link>
                <Link
                  href="/app/user/activity"
                  prefetch
                  className="inline-flex h-12 items-center justify-center rounded-full border border-border/50 bg-background/30 px-8 text-sm font-semibold text-foreground backdrop-blur transition-colors hover:bg-background/40"
                >
                  View activity
                </Link>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-3xl border border-border/40 bg-background/40 p-5 backdrop-blur-xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Wallet address</p>
                  <p className="mt-3 font-mono text-sm text-foreground/90">{shortAddress}</p>
                </div>
                <div className="rounded-3xl border border-border/40 bg-background/40 p-5 backdrop-blur-xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Status</p>
                  <p className="mt-3 text-sm font-semibold text-foreground">Active</p>
                </div>
                <div className="rounded-3xl border border-border/40 bg-background/40 p-5 backdrop-blur-xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Network</p>
                  <p className="mt-3 text-sm font-semibold text-foreground">Base mainnet</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[28px] border border-border/40 bg-background/50 p-5 shadow-[0_25px_80px_rgba(15,23,42,0.35)] backdrop-blur-2xl md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Available balance</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">Wallet totals</p>
                    <p className="mt-1 text-sm text-muted-foreground">Switch between your nTZS and USDC balances.</p>
                  </div>
                  <div className="rounded-full border border-border/40 bg-background/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Live
                  </div>
                </div>
                <div className="mt-8">
                  <BalanceToggle walletAddress={wallet.address} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-border/40 bg-background/35 p-5 backdrop-blur-xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Receive</p>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/85">Use your alias or QR code to collect TZS instantly.</p>
                </div>
                <div className="rounded-3xl border border-border/40 bg-background/35 p-5 backdrop-blur-xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Exchange</p>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/85">Swap nTZS and USDC directly from your wallet.</p>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <PayMeSection
              currentAlias={dbUser.payAlias ?? null}
              suggestedAlias={suggestedAlias}
            />
            <GlassCard>
              <div className="p-4 md:p-5">
                <SwapHistory />
              </div>
            </GlassCard>
          </div>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
              <SendSection walletAddress={wallet.address} />
              <SwapSection walletAddress={wallet.address} />
            </div>
            <Link
              href="/app/user/withdraw"
              prefetch
              className="flex min-h-[128px] flex-col justify-between rounded-[28px] border border-border/40 bg-card/70 p-5 text-left text-foreground shadow-[0_30px_90px_rgba(3,7,18,0.32)] backdrop-blur-2xl transition-transform duration-300 hover:-translate-y-1"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/40 bg-background/40">
                <svg className="h-5 w-5 text-foreground/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-semibold">Withdraw TZS</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Move funds out of your wallet when you are ready.</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
