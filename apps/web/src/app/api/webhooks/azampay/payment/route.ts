import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { verifyWebhookSignature, type AzamPayPaymentWebhookPayload } from '@/lib/psp/azampay'
import { executeMint } from '@/lib/minting/executeMint'
import { depositRequests, merchantCollections } from '@ntzs/db'

const SAFE_MINT_THRESHOLD_TZS = 1000000

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // ⚠ Verify AzamPay's actual signature and timestamp header names in sandbox.
  // These header names match Snippe's scheme — update once AzamPay scheme is confirmed.
  const signature = request.headers.get('x-webhook-signature') || ''
  const timestamp = request.headers.get('x-webhook-timestamp') || undefined

  if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
    // Header NAMES only (never values) — AzamPay's production signature scheme
    // is undocumented to us; the names on their real callback tell us what to
    // verify so this path can graduate from 401 to instant-mint.
    console.error('[azampay/payment webhook] Invalid signature or misconfigured secret', {
      headerNames: [...request.headers.keys()].sort(),
      bodyBytes: rawBody.length,
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: AzamPayPaymentWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[azampay/payment webhook] Invalid JSON')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ⚠ These field paths are provisional — update once AzamPay sandbox webhook
  // deliveries have been observed and documented.
  //
  // Expected payload shape (to verify):
  //   payload.externalId          → our pspReference (the UUID we sent as externalId)
  //   payload.status              → 'SUCCESS' | 'FAILED' (verify exact string)
  //   payload.amount              → numeric amount in TZS
  //   payload.currency            → 'TZS'
  //   payload.additionalProperties?.deposit_request_id → our deposit_request_id
  //   payload.additionalProperties?.webhookUrl         → passthrough

  const depositRequestId = (
    payload.additionalProperties?.deposit_request_id ??
    payload.metadata?.deposit_request_id
  ) as string | undefined

  if (!depositRequestId) {
    console.warn('[azampay/payment webhook] Missing deposit_request_id in payload')
    return NextResponse.json({ status: 'ignored', reason: 'no_deposit_request_id' })
  }

  const isCompleted = String(payload.status ?? '').toUpperCase() === 'SUCCESS'
    || String(payload.type ?? '').includes('completed')
  const isFailed = String(payload.status ?? '').toUpperCase() === 'FAILED'
    || String(payload.type ?? '').includes('failed')

  console.log(`[azampay/payment webhook] status=${payload.status} type=${payload.type} for deposit ${depositRequestId}`, {
    transactionId: payload.transactionId,
    externalId: payload.externalId,
  })

  const { db } = getDb()

  // Idempotency: only process if still in 'submitted' status
  const [deposit] = await db
    .select()
    .from(depositRequests)
    .where(and(eq(depositRequests.id, depositRequestId), eq(depositRequests.status, 'submitted')))
    .limit(1)

  if (!deposit) {
    console.warn(`[azampay/payment webhook] Deposit not found or already processed: ${depositRequestId}`)
    return NextResponse.json({ status: 'ignored', reason: 'not_found_or_processed' })
  }

  if (isCompleted) {
    const paidValue = Number(payload.amount ?? NaN)
    const paidCurrency = String(payload.currency ?? '').toUpperCase()

    if (paidCurrency !== 'TZS') {
      console.error('[azampay/payment webhook] Currency mismatch', {
        depositId: depositRequestId,
        expected: 'TZS',
        received: paidCurrency,
      })
      await db
        .update(depositRequests)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(depositRequests.id, depositRequestId))
      return NextResponse.json({ status: 'rejected', reason: 'currency_mismatch' }, { status: 400 })
    }

    if (!Number.isFinite(paidValue) || Math.trunc(paidValue) < deposit.amountTzs) {
      console.error('[azampay/payment webhook] Amount mismatch', {
        depositId: depositRequestId,
        expected: deposit.amountTzs,
        received: paidValue,
      })
      await db
        .update(depositRequests)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(depositRequests.id, depositRequestId))
      return NextResponse.json({ status: 'rejected', reason: 'amount_mismatch' }, { status: 400 })
    }

    const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'

    await db
      .update(depositRequests)
      .set({
        status: newStatus,
        pspReference: payload.externalId ?? payload.transactionId ?? deposit.pspReference,
        pspChannel: payload.provider ?? deposit.pspChannel,
        fiatConfirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(depositRequests.id, depositRequestId))

    console.log(`[azampay/payment webhook] Deposit ${depositRequestId} -> ${newStatus}`)

    revalidatePath('/app/user')
    revalidatePath('/app/user/activity')

    if (newStatus === 'mint_pending') {
      after(async () => {
        const result = await executeMint(depositRequestId)
        console.log(`[azampay/payment webhook] instant mint result for ${depositRequestId}:`, result.status)
        if (result.status === 'minted') {
          revalidatePath('/app/user')
          revalidatePath('/app/user/activity')

          const { db: afterDb } = getDb()
          await afterDb
            .update(merchantCollections)
            .set({ collectionStatus: 'minted', updatedAt: new Date() })
            .where(
              and(
                eq(merchantCollections.depositRequestId, depositRequestId),
                eq(merchantCollections.collectionStatus, 'pending')
              )
            )
        }
      })
    }

    return NextResponse.json({ status: 'success', depositId: depositRequestId, newStatus })
  }

  if (isFailed) {
    await db
      .update(depositRequests)
      .set({
        status: 'rejected',
        pspReference: payload.externalId ?? payload.transactionId ?? deposit.pspReference,
        updatedAt: new Date(),
      })
      .where(eq(depositRequests.id, depositRequestId))

    console.log(`[azampay/payment webhook] Deposit ${depositRequestId} -> rejected`, {
      reason: payload.failureReason,
    })

    revalidatePath('/app/user')
    revalidatePath('/app/user/activity')

    return NextResponse.json({ status: 'success', depositId: depositRequestId, newStatus: 'rejected' })
  }

  return NextResponse.json({ status: 'acknowledged', type: payload.type, statusValue: payload.status })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'azampay-payment-webhook' })
}
