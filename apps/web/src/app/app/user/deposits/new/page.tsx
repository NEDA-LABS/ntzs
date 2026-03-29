import { redirect } from 'next/navigation'
import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import { getCachedApprovedKyc, getCachedDefaultBank } from '@/lib/user/cachedQueries'

import { DepositForm } from './DepositForm'

export default async function NewDepositPage() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const [wallet, approvedKyc, defaultBank] = await Promise.all([
    getCachedWallet(dbUser.id),
    getCachedApprovedKyc(dbUser.id),
    getCachedDefaultBank(),
  ])

  if (!wallet) {
    redirect('/app/user/wallet')
  }

  if (!approvedKyc.length) {
    return (
      <div className="px-4 py-6 lg:p-8">
        <div className="mx-auto max-w-md">
          <div className="rounded-3xl border border-amber-500/25 bg-amber-500/[0.05] p-8 text-center backdrop-blur-xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-500/25">
              <svg className="h-8 w-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2" />
              </svg>
            </div>
            <h2 className="mt-5 text-xl font-bold text-white">Verify your identity first</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Submit your national ID to unlock deposits. It takes less than a minute and you&apos;ll be depositing right away.
            </p>
            <div className="mt-6 space-y-3">
              <Link
                href="/app/user/kyc"
                className="block w-full rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 px-6 py-4 text-base font-semibold text-black shadow-lg shadow-amber-500/20 transition-all duration-75 active:scale-[0.98] hover:shadow-amber-500/40"
              >
                Submit my national ID
              </Link>
              <Link
                href="/app/user"
                className="block w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-4 text-base font-medium text-zinc-400 transition-all duration-75 active:scale-[0.98] hover:bg-white/[0.06]"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const displayName = dbUser.payAlias ?? dbUser.name ?? dbUser.email.split('@')[0]

  return (
    <div className="px-4 py-6 lg:p-8">
      <div className="mx-auto max-w-md">

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
            <img src="/ntzs-logo.png" alt="nTZS" className="h-7 w-7 object-contain" />
          </div>
          <p className="mt-3 text-sm text-zinc-400">Deposit to</p>
          <h1 className="mt-0.5 text-2xl font-bold text-white">@{displayName}</h1>
        </div>

        {/* Form card */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
          <DepositForm defaultBankId={defaultBank?.id} userPhone={dbUser.phone} />
        </div>

        <p className="mt-6 text-center text-xs text-zinc-600">
          Funds are minted 1:1 as nTZS after payment confirms
        </p>
      </div>
    </div>
  )
}
