'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { getDb } from '@/lib/db'
import { depositRequests, users, wallets, banks } from '@ntzs/db'
import {
  initiatePayment,
  normalizePhone,
  isValidTanzanianPhone,
} from '@/lib/psp/snippe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export type PayResult =
  | { success: true; depositId: string }
  | { success: false; error: string }

export async function createPayLinkDeposit(
  alias: string,
  formData: FormData
): Promise<PayResult> {
  const amountRaw = String(formData.get('amount') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  const payerName = String(formData.get('payerName') ?? '').trim()

  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: 'Enter a valid amount' }
  }

  if (!phone) {
    return { success: false, error: 'Phone number is required' }
  }

  if (!isValidTanzanianPhone(phone)) {
    return { success: false, error: 'Enter a valid Tanzanian phone number' }
  }

  const { db } = getDb()

  // Look up recipient by alias
  const recipient = await db.query.users.findFirst({
    where: eq(users.payAlias, alias.toLowerCase()),
  })

  if (!recipient) {
    return { success: false, error: 'Payment link is not active' }
  }

  // Get recipient's wallet
  const wallet = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, recipient.id), eq(wallets.chain, 'base')),
  })

  if (!wallet) {
    return { success: false, error: 'Recipient wallet not available' }
  }

  // Get default bank
  const bank = await db.query.banks.findFirst({
    where: eq(banks.status, 'active'),
  })

  if (!bank) {
    return { success: false, error: 'Payment service temporarily unavailable' }
  }

  const idempotencyKey = crypto.randomUUID()
  const amountTzs = Math.trunc(amount)

  // Create deposit request tagged as pay_link collection
  const [deposit] = await db
    .insert(depositRequests)
    .values({
      userId: recipient.id,
      bankId: bank.id,
      walletId: wallet.id,
      chain: wallet.chain,
      amountTzs,
      idempotencyKey,
      status: 'submitted',
      paymentProvider: 'snippe',
      buyerPhone: normalizePhone(phone),
      source: 'pay_link',
      payerName: payerName || null,
    })
    .returning({ id: depositRequests.id })

  // Trigger mobile money push-to-pay
  try {
    const response = await initiatePayment({
      amountTzs,
      phoneNumber: phone,
      customerEmail: recipient.email,
      customerFirstname: payerName || 'Customer',
      webhookUrl: `${APP_URL}/api/webhooks/snippe/payment`,
      metadata: { deposit_request_id: deposit.id },
    })

    if (!response.success) {
      await db
        .update(depositRequests)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(depositRequests.id, deposit.id))
      return { success: false, error: response.error || 'Failed to send payment prompt' }
    }

    await db
      .update(depositRequests)
      .set({ pspReference: response.reference, updatedAt: new Date() })
      .where(eq(depositRequests.id, deposit.id))

    // Revalidate recipient's pages so the collection shows up immediately
    revalidatePath('/app/user')
    revalidatePath('/app/user/activity')

    return { success: true, depositId: deposit.id }
  } catch (err) {
    await db
      .update(depositRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(depositRequests.id, deposit.id))
    return { success: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}
