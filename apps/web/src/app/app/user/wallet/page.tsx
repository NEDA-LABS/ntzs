import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedWallet } from '@/lib/user/cachedWallet'

import { WalletInfoClient } from './WalletInfoClient'
import { PayMeSection } from './PayMeSection'

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

  return (
    <div className="px-4 py-5 lg:p-8">
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Your Wallet</h1>
          <p className="mt-1 text-sm text-zinc-400">Receive nTZS on Base network</p>
        </div>

        {/* Pay Me -- collection QR + link */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
          <PayMeSection
            currentAlias={dbUser.payAlias ?? null}
            suggestedAlias={suggestedAlias}
          />
        </div>

        {/* Withdraw */}
        <Link
          href="/app/user/withdraw"
          prefetch
          className="flex items-center justify-center gap-2 rounded-2xl border border-amber-400/20 bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-rose-500/20 p-4 text-sm font-semibold text-amber-50 backdrop-blur-xl transition-all duration-75 hover:from-amber-500/30 hover:via-orange-500/20 hover:to-rose-500/25 active:scale-[0.98]"
        >
          <svg className="h-4 w-4 text-amber-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          Withdraw
        </Link>

        {/* Wallet address + QR */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
          <WalletInfoClient address={wallet.address} />
        </div>
      </div>
    </div>
  )
}
