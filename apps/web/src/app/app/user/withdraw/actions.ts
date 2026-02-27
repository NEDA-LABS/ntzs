'use server'

import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { burnRequests, kycCases, wallets } from '@ntzs/db'
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp/snippe'

const SAFE_BURN_THRESHOLD_TZS = 100000

export async function createWithdrawRequestAction(formData: FormData) {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const amountTzsRaw = String(formData.get('amountTzs') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()

  const amountTzs = Number(amountTzsRaw)
  if (!Number.isFinite(amountTzs) || amountTzs < 1000) {
    throw new Error('Minimum withdrawal amount is 1,000 TZS')
  }

  if (!phone) {
    throw new Error('Phone number is required for mobile money payout')
  }
  if (!isValidTanzanianPhone(phone)) {
    throw new Error('Invalid Tanzanian mobile number')
  }

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

  const contractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE ?? process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA
  if (!contractAddress) throw new Error('Contract not configured')

  // Small amounts auto-approved; large ones require admin sign-off
  const status = amountTzs >= SAFE_BURN_THRESHOLD_TZS ? 'requires_second_approval' : 'approved'

  await db.insert(burnRequests).values({
    userId: dbUser.id,
    walletId: wallet.id,
    chain: wallet.chain,
    contractAddress,
    amountTzs: Math.trunc(amountTzs),
    reason: 'User withdrawal',
    status,
    requestedByUserId: dbUser.id,
    recipientPhone: normalizePhone(phone),
  })

  redirect('/app/user/activity')
}
