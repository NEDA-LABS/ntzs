import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import { TokenBalance } from '../_components/TokenBalance'
import { PayMeSection } from './PayMeSection'
import { SendSection } from './SendSection'
import { SwapSection } from './SwapSection'

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
    <div className="min-h-screen bg-[#0d0d14] px-4 py-6 lg:p-8">
      <div className="mx-auto max-w-lg space-y-5">

        {/* Hero: identity + balance */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#12121e] to-[#0f0f1a] p-6 ring-1 ring-white/[0.06]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:44px_44px]" />
          <div className="pointer-events-none absolute -top-16 right-0 h-48 w-64 rounded-full bg-blue-600/[0.07] blur-3xl" />
          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Your wallet</p>
              <h1 className="mt-1 text-xl font-bold text-white">
                {dbUser.payAlias ? `@${dbUser.payAlias}` : dbUser.email}
              </h1>
              <p className="mt-0.5 text-xs text-zinc-500">Base network · nTZS</p>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-blue-600/15 px-3 py-2 ring-1 ring-blue-600/20">
              <svg className="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18-3a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3m18 0V6" />
              </svg>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-wide text-blue-400">Balance</p>
                <TokenBalance walletAddress={wallet.address} compact />
              </div>
            </div>
          </div>
        </div>

        {/* Pay Me — QR + link */}
        <PayMeSection
          currentAlias={dbUser.payAlias ?? null}
          suggestedAlias={suggestedAlias}
        />

        {/* Send */}
        <SendSection walletAddress={wallet.address} />

        {/* Swap */}
        <SwapSection walletAddress={wallet.address} />

        {/* Withdraw */}
        <Link
          href="/app/user/withdraw"
          prefetch
          className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-[#12121e] px-5 py-4 text-sm font-semibold text-white ring-1 ring-white/[0.06] transition-all duration-75 hover:bg-white/[0.04] active:scale-[0.98]"
        >
          <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          Withdraw TZS
        </Link>

      </div>
    </div>
  )
}
