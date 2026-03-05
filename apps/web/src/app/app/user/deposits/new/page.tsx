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
    <div className="p-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Top up wallet</h1>
          <p className="mt-1 text-sm text-zinc-400">TZS to nTZS (1:1)</p>
        </div>

        <DepositForm defaultBankId={defaultBank?.id} userPhone={dbUser.phone} />
      </div>
    </div>
  )
}
