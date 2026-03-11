import { redirect } from 'next/navigation'

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
    redirect('/app/user/kyc')
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
