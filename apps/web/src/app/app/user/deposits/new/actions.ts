'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireDbUser, requireRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { depositRequests, kycCases, wallets, banks } from '@ntzs/db'
import {
  createZenoPayPayment,
  formatTanzanianPhone,
  isValidTanzanianMobileNumber,
} from '@/lib/psp/zenopay'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function createDepositRequestAction(formData: FormData) {
  await requireRole('end_user')
  const dbUser = await requireDbUser()

  const bankId = String(formData.get('bankId') ?? '').trim()
  const amountTzsRaw = String(formData.get('amountTzs') ?? '').trim()
  const paymentMethod = String(formData.get('paymentMethod') ?? 'bank').trim()
  const buyerPhone = String(formData.get('buyerPhone') ?? '').trim()

  if (!bankId) {
    throw new Error('Missing bank')
  }

  const amountTzs = Number(amountTzsRaw)
  if (!Number.isFinite(amountTzs) || amountTzs <= 0) {
    throw new Error('Invalid amount')
  }

  // Validate phone for M-Pesa
  if (paymentMethod === 'mpesa') {
    if (!buyerPhone) {
      throw new Error('Phone number required for M-Pesa')
    }
    if (!isValidTanzanianMobileNumber(buyerPhone)) {
      throw new Error('Invalid Tanzanian mobile number')
    }
  }

  const { db } = getDb()

  const wallet = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, dbUser.id), eq(wallets.chain, 'base')),
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

  const idempotencyKey = crypto.randomUUID()

  // Create deposit request
  const [deposit] = await db
    .insert(depositRequests)
    .values({
      userId: dbUser.id,
      bankId,
      walletId: wallet.id,
      chain: wallet.chain,
      amountTzs: Math.trunc(amountTzs),
      idempotencyKey,
      status: 'submitted',
      paymentProvider: paymentMethod === 'mpesa' ? 'zenopay' : 'bank_transfer',
      buyerPhone: paymentMethod === 'mpesa' ? formatTanzanianPhone(buyerPhone) : null,
    })
    .returning({ id: depositRequests.id })

  // If M-Pesa, trigger ZenoPay payment
  if (paymentMethod === 'mpesa') {
    try {
      const response = await createZenoPayPayment({
        order_id: deposit.id,
        buyer_email: dbUser.email,
        buyer_name: dbUser.email.split('@')[0],
        buyer_phone: formatTanzanianPhone(buyerPhone),
        amount: Math.trunc(amountTzs),
        webhook_url: `${APP_URL}/api/webhooks/zenopay`,
      })

      if (response.status !== 'success') {
        // Mark deposit as failed
        await db
          .update(depositRequests)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(depositRequests.id, deposit.id))
        throw new Error(response.message || 'Failed to initiate M-Pesa payment')
      }

      console.log(`[ZenoPay] Payment initiated for deposit ${deposit.id}`)
    } catch (error) {
      await db
        .update(depositRequests)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(depositRequests.id, deposit.id))
      throw error
    }
  }

  revalidatePath('/app/user')
  revalidatePath('/app/user/activity')

  redirect('/app/user/activity')
}
