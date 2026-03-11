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

  return (
    <div className="min-h-screen bg-[#0d0d14] px-4 py-6 lg:p-8">
      <div className="mx-auto max-w-xl">

        {/* Hero header */}
        <div className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-[#12121e] to-[#0f0f1a] p-6 ring-1 ring-white/[0.06]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:44px_44px]" />
          <div className="pointer-events-none absolute -top-16 right-0 h-48 w-64 rounded-full bg-blue-600/[0.07] blur-3xl" />
          <div className="relative">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Top up</p>
            <h1 className="mt-1 text-xl font-bold text-white">Deposit TZS</h1>
            <p className="mt-0.5 text-xs text-zinc-500">Funds are minted 1:1 as nTZS after payment confirms</p>
          </div>
        </div>

        <DepositForm defaultBankId={defaultBank?.id} userPhone={dbUser.phone} />
      </div>
    </div>
  )
}
