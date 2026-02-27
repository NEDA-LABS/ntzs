'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { depositRequests, kycCases, wallets, banks } from '@ntzs/db'
import {
  initiatePayment,
  initiateCardPayment,
  normalizePhone,
  isValidTanzanianPhone,
} from '@/lib/psp/snippe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function createDepositRequestAction(formData: FormData) {
  await requireAnyRole(['end_user', 'super_admin'])
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
      throw new Error('Phone number required for mobile money')
    }
    if (!isValidTanzanianPhone(buyerPhone)) {
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
      paymentProvider: paymentMethod === 'mpesa' ? 'snippe' : 'snippe_card',
      buyerPhone: paymentMethod === 'mpesa' ? normalizePhone(buyerPhone) : null,
    })
    .returning({ id: depositRequests.id })

  // If mobile money, trigger Snippe payment
  if (paymentMethod === 'mpesa') {
    try {
      const response = await initiatePayment({
        amountTzs: Math.trunc(amountTzs),
        phoneNumber: buyerPhone,
        customerEmail: dbUser.email,
        customerFirstname: dbUser.email.split('@')[0],
        webhookUrl: `${APP_URL}/api/webhooks/snippe/payment`,
        metadata: { deposit_request_id: deposit.id },
      })

      if (!response.success) {
        await db
          .update(depositRequests)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(depositRequests.id, deposit.id))
        throw new Error(response.error || 'Failed to initiate mobile money payment')
      }

      // Store Snippe payment reference for status polling
      await db
        .update(depositRequests)
        .set({ pspReference: response.reference, updatedAt: new Date() })
        .where(eq(depositRequests.id, deposit.id))

      console.log(`[snippe] payment initiated for deposit ${deposit.id}, ref: ${response.reference}`)
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

export async function createCardDepositRequestAction(formData: FormData): Promise<{ paymentUrl: string }> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const bankId = String(formData.get('bankId') ?? '').trim()
  const amountTzsRaw = String(formData.get('amountTzs') ?? '').trim()

  if (!bankId) throw new Error('Missing bank')

  const amountTzs = Number(amountTzsRaw)
  if (!Number.isFinite(amountTzs) || amountTzs <= 0) throw new Error('Invalid amount')

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

  const idempotencyKey = crypto.randomUUID()

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
      paymentProvider: 'snippe_card',
    })
    .returning({ id: depositRequests.id })

  const response = await initiateCardPayment({
    amountTzs: Math.trunc(amountTzs),
    customerEmail: dbUser.email,
    customerFirstname: dbUser.email.split('@')[0],
    redirectUrl: `${APP_URL}/app/user/deposits/card-return?status=success&deposit=${deposit.id}`,
    cancelUrl: `${APP_URL}/app/user/deposits/card-return?status=cancel&deposit=${deposit.id}`,
    webhookUrl: `${APP_URL}/api/webhooks/snippe/payment`,
    metadata: { deposit_request_id: deposit.id },
  })

  if (!response.success || !response.paymentUrl) {
    await db
      .update(depositRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(depositRequests.id, deposit.id))
    throw new Error(response.error || 'Failed to initiate card payment')
  }

  await db
    .update(depositRequests)
    .set({ pspReference: response.reference, updatedAt: new Date() })
    .where(eq(depositRequests.id, deposit.id))

  console.log(`[snippe] card payment initiated for deposit ${deposit.id}, ref: ${response.reference}`)

  return { paymentUrl: response.paymentUrl }
}
