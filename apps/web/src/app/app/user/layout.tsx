import type { ReactNode } from 'react'

import { requireAnyRole } from '@/lib/auth/rbac'
import { UserTopBar } from '@/app/app/_components/UserTopBar'
import { provisionPlatformWallet } from '@/lib/waas/platform-wallets'
import { getCachedWallet, invalidateWalletCache } from '@/lib/user/cachedWallet'
import { WALLET_CREATION_PAUSED } from '@/lib/wallet-gating'

import { NotificationCenter } from '@/app/app/_components/NotificationCenter'
import { MobileSidebar } from './_components/MobileSidebar'
import { PendingDepositPoller } from './_components/PendingDepositPoller'

export default async function UserLayout({ children }: { children: ReactNode }) {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  let wallet = await getCachedWallet(dbUser.id)

  // Auto-provision an HD wallet for new direct users who have none yet
  if (!wallet) {
    const address = await provisionPlatformWallet(dbUser.id)
    if (address) {
      invalidateWalletCache(dbUser.id)
      wallet = await getCachedWallet(dbUser.id)
    }
  }

  // Sandbox: new users can't be issued a wallet until KYC is live. Show a clear
  // paused screen instead of a wallet-less dashboard. Existing users have wallets.
  if (!wallet && WALLET_CREATION_PAUSED) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0d14] px-6 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold text-white">Account setup paused</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            New wallets are temporarily paused while we finalise identity verification for the
            Bank of Tanzania sandbox. Your account is saved — please check back soon to complete
            setup with verified KYC.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-[#0d0d14]">
      {/* Collapsible Sidebar */}
      <MobileSidebar wallet={wallet ?? null} />

      {/* Main Content - responsive padding */}
      <main className="flex-1 min-w-0 pl-0 lg:pl-64">
        <UserTopBar />
        <div className="pb-20 lg:pb-0">
          {children}
        </div>
      </main>
      {/* Always-on poller — detects deposit status transitions on every page */}
      <PendingDepositPoller hasPending={true} />
      <NotificationCenter />
    </div>
  )
}
