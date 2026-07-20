'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { depositRequests, kycCases, banks } from '@ntzs/db'
import { getUserPrimaryWallet } from '@/lib/user/getUserPrimaryWallet'
import {
  ACTIVE_PSP_PROVIDER,
  initiateCollection,
  initiateCardPayment,
  normalizePhone,
  isValidTanzanianPhone,
  lookupAccountName,
} from '@/lib/psp'
import { writeAuditLog } from '@/lib/audit'

const APP_URL = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.ntzs.co.tz'

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

  const wallet = await getUserPrimaryWallet(dbUser.id)

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
      paymentProvider: paymentMethod === 'mpesa' ? ACTIVE_PSP_PROVIDER : 'snippe_card',
      buyerPhone: paymentMethod === 'mpesa' ? normalizePhone(buyerPhone) : null,
    })
    .returning({ id: depositRequests.id })

  // If mobile money, initiate the collection with per-network rail failover
  // (one PSP being down no longer blocks deposits — see lib/psp/routing.ts).
  if (paymentMethod === 'mpesa') {
    try {
      const routed = await initiateCollection({
        amountTzs: Math.trunc(amountTzs),
        phoneNumber: buyerPhone,
        customerEmail: dbUser.email,
        customerFirstname: dbUser.email.split('@')[0],
        webhookBaseUrl: APP_URL,
        metadata: { deposit_request_id: deposit.id },
      })
      const response = routed.payment

      if (!response.success) {
        await db
          .update(depositRequests)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(depositRequests.id, deposit.id))
        throw new Error(response.error || 'Failed to initiate mobile money payment')
      }

      // Persist the rail that ACTUALLY served (failover may differ from the
      // default) — webhooks and pollers are provider-scoped. pspChannel keeps
      // the detected MNO where the rail reports one (AzamPay status polling
      // needs it).
      await db
        .update(depositRequests)
        .set({
          paymentProvider: routed.provider,
          pspReference: response.reference,
          pspChannel: (response as { provider?: string }).provider ?? null,
          updatedAt: new Date(),
        })
        .where(eq(depositRequests.id, deposit.id))

      // Both ids on record: PSP callbacks may echo only OUR externalId
      // (AzamPay names it utilityref) — the webhook matches through this row.
      if (response.externalId) {
        await writeAuditLog('deposit.psp_initiated', 'deposit_request', deposit.id, {
          provider: routed.provider,
          reference: response.reference ?? null,
          externalId: response.externalId,
        }, dbUser.id)
      }

      console.log(`[${routed.provider}] payment initiated for deposit ${deposit.id}, ref: ${response.reference}`)
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

  return { depositId: deposit.id }
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

  const wallet = await getUserPrimaryWallet(dbUser.id)
  if (!wallet) throw new Error('No wallet found. Please set up your wallet first.')

  const approvedKyc = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .where(and(eq(kycCases.userId, dbUser.id), eq(kycCases.status, 'approved')))
    .limit(1)
  if (!approvedKyc.length) throw new Error('KYC verification required before making a deposit.')

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
    phoneNumber: dbUser.phone || '255700000000',
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

/**
 * Look up the AzamPay-registered name for a mobile money phone number.
 * Called from the deposit form to show "Paying as: John Doe" before the user confirms.
 * Returns { name: null } on any failure — never throws.
 */
export async function lookupAccountNameAction(phone: string): Promise<{ name: string | null }> {
  await requireAnyRole(['end_user', 'super_admin'])
  if (!phone) return { name: null }
  return lookupAccountName(phone)
}
