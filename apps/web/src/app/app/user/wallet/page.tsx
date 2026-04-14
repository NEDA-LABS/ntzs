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
import { TopActions } from './_components/TopActions'
// Tabs removed from hero for a minimal surface

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

  return (
    <div className="ntzs-wallet-shell min-h-screen px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="p-0 md:p-0 space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Base network wallet</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
              {displayName}
            </h1>
          </div>

          <div id="receive">
            <PayMeSection
              currentAlias={dbUser.payAlias ?? null}
              suggestedAlias={suggestedAlias}
              walletAddress={wallet.address}
            />
          </div>
          <TopActions />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-border/40 bg-card/60 p-5 backdrop-blur-2xl">
              <div className="p-0 md:p-0">
                <SwapHistory />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
              <div id="send">
                <details className="group lg:open">
                  <summary className="flex cursor-pointer list-none items-center justify-between rounded-[18px] border border-border/40 bg-background/35 px-4 py-3 text-sm font-semibold text-foreground backdrop-blur-xl">
                    Full Send
                    <span className="text-xs font-normal text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <div className="mt-3">
                    <SendSection walletAddress={wallet.address} />
                  </div>
                </details>
              </div>
              <div id="swap">
                <details className="group lg:open">
                  <summary className="flex cursor-pointer list-none items-center justify-between rounded-[18px] border border-border/40 bg-background/35 px-4 py-3 text-sm font-semibold text-foreground backdrop-blur-xl">
                    Full Swap
                    <span className="text-xs font-normal text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <div className="mt-3">
                    <SwapSection walletAddress={wallet.address} />
                  </div>
                </details>
              </div>
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
