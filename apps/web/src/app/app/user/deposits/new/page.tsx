import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { banks, kycCases, wallets } from '@ntzs/db'

import { DepositForm } from './DepositForm'

export default async function NewDepositPage() {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const { db } = getDb()

  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, dbUser.id),
  })

  if (!wallet) {
    redirect('/app/user/wallet')
  }

  const approvedKyc = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .where(and(eq(kycCases.userId, dbUser.id), eq(kycCases.status, 'approved')))
    .limit(1)

  if (!approvedKyc.length) {
    redirect('/app/user/kyc')
  }

  // Get a default bank for mobile money deposits
  const defaultBank = await db.query.banks.findFirst({
    where: eq(banks.status, 'active'),
  })

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
