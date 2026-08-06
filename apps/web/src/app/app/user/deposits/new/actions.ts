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
import { W2B_CHANNEL, BANK_CHANNEL, formatBankReference, normalizeAccountNumber } from '@/lib/psp/selcom-statement'
import { getW2bConfig, getBankCollectionConfig } from '@/lib/psp/selcom-w2b'
import { allocateBankReference } from '@/lib/deposits/bank-collection'
import { writeAuditLog } from '@/lib/audit'

const APP_URL = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.ntzs.co.tz'

/**
 * Thrown when the PSP gave us no usable answer. Carries the meaning "the
 * deposit row was left OPEN on purpose" so the surrounding error handling
 * cannot cancel a deposit whose money may already be in flight.
 */
class UncertainInitiationError extends Error {}

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
    // Set once the PSP has accepted the collection. After that point NOTHING
    // may cancel the row — the customer's money is in flight, and a later
    // bookkeeping error must never present as a cancelled deposit.
    let initiationAccepted = false
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
        // Only a DEFINITIVE refusal closes the deposit. An uncertain one stays
        // open: the collection may have been taken, and a cancelled row makes
        // the completion webhook ignore the payment entirely (4 Aug 2026).
        if (response.definitiveFailure) {
          await db
            .update(depositRequests)
            .set({ status: 'cancelled', paymentProvider: routed.provider, updatedAt: new Date() })
            .where(eq(depositRequests.id, deposit.id))
          throw new Error(response.error || 'Failed to initiate mobile money payment')
        }

        await db
          .update(depositRequests)
          .set({ paymentProvider: routed.provider, updatedAt: new Date() })
          .where(eq(depositRequests.id, deposit.id))

        await writeAuditLog('deposit.initiation_uncertain', 'deposit_request', deposit.id, {
          provider: routed.provider,
          attempted: routed.attempted,
          error: response.error ?? null,
          note: 'left submitted on purpose — the collection may have been taken',
        }, dbUser.id)

        throw new UncertainInitiationError(
          'We could not confirm the payment prompt. If you received it and approved the payment, ' +
            'your nTZS will be credited automatically — do not pay again.'
        )
      }

      initiationAccepted = true

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
          ack: response.ack ?? null,
        }, dbUser.id)
      }

      console.log(`[${routed.provider}] payment initiated for deposit ${deposit.id}, ref: ${response.reference}`)
    } catch (error) {
      // Cancel ONLY when we know no collection is in flight. An uncertain
      // initiation, or any failure after the PSP already accepted, leaves the
      // row open so the completion webhook can still settle it.
      if (!initiationAccepted && !(error instanceof UncertainInitiationError)) {
        await db
          .update(depositRequests)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(depositRequests.id, deposit.id))
      }
      throw error
    }
  }

  revalidatePath('/app/user')
  revalidatePath('/app/user/activity')

  return { depositId: deposit.id }
}

/**
 * Create a w2b (Lipa Namba) deposit intent — no push is sent. The user pays
 * our Selcom Lipa Namba from their own mobile-money menu; the
 * selcom-statement-sync cron matches the incoming credit to this row by
 * amount + payer phone and advances it to mint. The phone entered here MUST
 * be the line the money is sent from, or the payment lands in the manual
 * orphan queue instead of auto-crediting.
 */
export async function createW2bDepositIntentAction(
  formData: FormData
): Promise<{ depositId: string; lipaNamba: string; accountName: string | null }> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const w2b = getW2bConfig()
  if (!w2b) {
    throw new Error('Lipa Namba deposits are not available right now')
  }

  const bankId = String(formData.get('bankId') ?? '').trim()
  const amountTzsRaw = String(formData.get('amountTzs') ?? '').trim()
  const buyerPhone = String(formData.get('buyerPhone') ?? '').trim()

  if (!bankId) throw new Error('Missing bank')

  const amountTzs = Number(amountTzsRaw)
  if (!Number.isFinite(amountTzs) || amountTzs <= 0) throw new Error('Invalid amount')

  if (!buyerPhone) throw new Error('Phone number required — we match your payment by the number it is sent from')
  if (!isValidTanzanianPhone(buyerPhone)) throw new Error('Invalid Tanzanian mobile number')

  const { db } = getDb()

  const wallet = await getUserPrimaryWallet(dbUser.id)
  if (!wallet) redirect('/app/user/wallet')

  const approvedKyc = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .where(and(eq(kycCases.userId, dbUser.id), eq(kycCases.status, 'approved')))
    .limit(1)
  if (!approvedKyc.length) redirect('/app/user/kyc')

  const [deposit] = await db
    .insert(depositRequests)
    .values({
      userId: dbUser.id,
      bankId,
      walletId: wallet.id,
      chain: wallet.chain,
      amountTzs: Math.trunc(amountTzs),
      idempotencyKey: crypto.randomUUID(),
      status: 'submitted',
      paymentProvider: 'selcom',
      pspChannel: W2B_CHANNEL,
      buyerPhone: normalizePhone(buyerPhone),
    })
    .returning({ id: depositRequests.id })

  await writeAuditLog('deposit.w2b_intent_created', 'deposit_request', deposit.id, {
    lipaNamba: w2b.lipaNamba,
    amountTzs: Math.trunc(amountTzs),
  }, dbUser.id)

  revalidatePath('/app/user')
  revalidatePath('/app/user/activity')

  return { depositId: deposit.id, lipaNamba: w2b.lipaNamba, accountName: w2b.accountName }
}

/**
 * Create a bank-transfer deposit intent (banking phase 3) — no push is sent.
 * The user sends a bank transfer (TIPS) to our Selcom account with the
 * returned reference in the narration; the selcom-statement-sync cron matches
 * the credit by that reference + exact amount and advances it to mint. Bank
 * credits carry no payer phone, so the reference — not a phone — is the
 * matching key.
 */
export async function createBankDepositIntentAction(formData: FormData): Promise<{
  depositId: string
  reference: string
  accountNumber: string
  accountName: string | null
  institution: string
}> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const cfg = getBankCollectionConfig()
  if (!cfg) {
    throw new Error('Bank transfer deposits are not available right now')
  }

  const bankId = String(formData.get('bankId') ?? '').trim()
  const amountTzsRaw = String(formData.get('amountTzs') ?? '').trim()
  // Banks routinely strip the reference in transit, so the account the payer
  // sends FROM is the identity that actually survives to our statement.
  const payerAccountNumber = normalizeAccountNumber(String(formData.get('payerAccountNumber') ?? ''))

  if (!bankId) throw new Error('Missing bank')
  if (!payerAccountNumber) {
    throw new Error('Your bank account number is required — it is how we identify your transfer when it arrives')
  }

  const amountTzs = Number(amountTzsRaw)
  if (!Number.isFinite(amountTzs) || amountTzs <= 0) throw new Error('Invalid amount')

  const { db } = getDb()

  const wallet = await getUserPrimaryWallet(dbUser.id)
  if (!wallet) redirect('/app/user/wallet')

  const approvedKyc = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .where(and(eq(kycCases.userId, dbUser.id), eq(kycCases.status, 'approved')))
    .limit(1)
  if (!approvedKyc.length) redirect('/app/user/kyc')

  const reference = await allocateBankReference(db)

  const [deposit] = await db
    .insert(depositRequests)
    .values({
      userId: dbUser.id,
      bankId,
      walletId: wallet.id,
      chain: wallet.chain,
      amountTzs: Math.trunc(amountTzs),
      idempotencyKey: crypto.randomUUID(),
      status: 'submitted',
      paymentProvider: 'selcom',
      pspChannel: BANK_CHANNEL,
      payerAccountNumber,
      pspReference: reference,
    })
    .returning({ id: depositRequests.id })

  await writeAuditLog('deposit.bank_intent_created', 'deposit_request', deposit.id, {
    reference,
    accountNumber: cfg.accountNumber,
    amountTzs: Math.trunc(amountTzs),
  }, dbUser.id)

  revalidatePath('/app/user')
  revalidatePath('/app/user/activity')

  return {
    depositId: deposit.id,
    reference: formatBankReference(reference),
    accountNumber: cfg.accountNumber,
    accountName: cfg.accountName,
    institution: cfg.institution,
  }
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
