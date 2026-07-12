import type { ReactNode } from 'react'

import { requireAnyRole } from '@/lib/auth/rbac'
import { UserTopBar } from '@/app/app/_components/UserTopBar'
import { provisionPlatformWallet } from '@/lib/waas/platform-wallets'
import { NidaVerifyForm } from './kyc/NidaVerifyForm'
import { getCachedWallet, invalidateWalletCache } from '@/lib/user/cachedWallet'
import { DIRECT_APP_SIGNUP_PAUSED, NEDAPAY_APP_URL } from '@/lib/wallet-gating'

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

  // STRUCTURAL PREREQUISITE (BoT Parameter 8): wallets are issued only to
  // KYC-verified identities, always. Wallet-less users verify their NIDA right
  // here (this layout wraps /app/user/kyc too, so an inline form avoids a
  // redirect loop); once approved, the next load auto-provisions their wallet.
  // Existing users have wallets and never see this.
  if (!wallet) {
    // Pilot capacity: while direct-app sign-ups are paused, wallet-less
    // accounts (= new sign-ups, however they got here) are handed to NEDApay
    // instead of the NIDA form. Users with approved KYC were provisioned
    // above; wallet holders never reach this branch.
    if (DIRECT_APP_SIGNUP_PAUSED) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0d0d14] px-6 text-center">
          <div className="max-w-md">
            <h1 className="text-2xl font-semibold text-white">Continue in NEDApay</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              Our Bank of Tanzania sandbox pilot on this app is at capacity, so new nTZS accounts
              are activated in the NEDApay app instead. Existing accounts are unaffected.
            </p>
            <a
              href={NEDAPAY_APP_URL}
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90"
            >
              Open NEDApay →
            </a>
          </div>
        </div>
      )
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0d14] px-6 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold text-white">Verify your identity</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            To activate your nTZS account, verify your identity with your NIDA number — a Bank of
            Tanzania sandbox requirement. It takes under a minute.
          </p>
          <div className="mt-6">
            <NidaVerifyForm redirectTo="/app/user" />
          </div>
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
