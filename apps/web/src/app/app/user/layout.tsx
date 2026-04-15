import type { ReactNode } from 'react'

import { requireAnyRole } from '@/lib/auth/rbac'
import { UserTopBar } from '@/app/app/_components/UserTopBar'
import { DepositSuccessToast } from '@/app/app/_components/DepositSuccessToast'
import { provisionPlatformWallet } from '@/lib/waas/platform-wallets'
import { getCachedWallet, invalidateWalletCache } from '@/lib/user/cachedWallet'

import { MobileSidebar } from './_components/MobileSidebar'

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
      <DepositSuccessToast />
    </div>
  )
}
