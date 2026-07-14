import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { kycCases, wallets } from '@ntzs/db'
import { getActiveProviderId } from '@/lib/psp'

import { WithdrawForm } from './WithdrawForm'

export default async function WithdrawPage() {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const { db } = getDb()

  const wallet = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, dbUser.id), eq(wallets.chain, 'base')),
  })
  if (!wallet) redirect('/app/user/wallet')

  const approvedKyc = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .where(and(eq(kycCases.userId, dbUser.id), eq(kycCases.status, 'approved')))
    .limit(1)
  if (!approvedKyc.length) redirect('/app/user/kyc')

  // Resolved server-side so the form can quote the routed provider's fee.
  // The submit action re-resolves with the exact amount (amount-band rules
  // may refine the provider); the server's figure is authoritative.
  const pspProvider = await getActiveProviderId('payouts_mobile')

  return (
    <div className="px-4 py-6 lg:p-8">
      <div className="mx-auto max-w-md sm:max-w-xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Withdraw</h1>
          <p className="mt-1 text-sm text-muted-foreground">nTZS to TZS (1:1) — paid out via mobile money</p>
        </div>

        <WithdrawForm userPhone={dbUser.phone} pspProvider={pspProvider} />
      </div>
    </div>
  )
}
