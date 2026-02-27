import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { kycCases, wallets } from '@ntzs/db'

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

  return (
    <div className="p-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Withdraw</h1>
          <p className="mt-1 text-sm text-zinc-400">nTZS to TZS (1:1) — paid out via Snippe mobile money</p>
        </div>

        <WithdrawForm userPhone={dbUser.phone} />
      </div>
    </div>
  )
}
