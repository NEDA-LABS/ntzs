import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { wallets } from '@ntzs/db'

import { WalletInfoClient } from './WalletInfoClient'

export default async function WalletPage() {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()
  const { db } = getDb()

  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, dbUser.id),
  })

  // Layout auto-provisions the wallet — redirect back if still missing
  if (!wallet) {
    redirect('/app/user')
  }

  return (
    <div className="px-4 py-5 lg:p-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Your Wallet</h1>
          <p className="mt-1 text-sm text-zinc-400">Receive nTZS on Base network</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
          <WalletInfoClient address={wallet.address} />
        </div>
      </div>
    </div>
  )
}
