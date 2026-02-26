import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { verifyWebhookSignature, type SnippePaymentWebhookPayload } from '@/lib/psp/snippe'
import { depositRequests } from '@ntzs/db'

const SAFE_MINT_THRESHOLD_TZS = 9000

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-webhook-signature') || ''
  const timestamp = request.headers.get('x-webhook-timestamp') || undefined

  // Verify HMAC signature
  if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
    console.error('[snippe/payment webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: SnippePaymentWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[snippe/payment webhook] Invalid JSON')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, data } = payload

  // Extract our deposit_request_id from metadata
  const depositRequestId = data?.metadata?.deposit_request_id as string
  if (!depositRequestId) {
    console.warn('[snippe/payment webhook] Missing deposit_request_id in metadata')
    return NextResponse.json({ status: 'ignored', reason: 'no_deposit_request_id' })
  }

  console.log(`[snippe/payment webhook] ${type} for deposit ${depositRequestId}`, {
    reference: data.reference,
    status: data.status,
    amount: data.amount?.value,
  })

  const { db } = getDb()

  // Idempotency: only process if still in 'submitted' status
  const [deposit] = await db
    .select()
    .from(depositRequests)
    .where(and(eq(depositRequests.id, depositRequestId), eq(depositRequests.status, 'submitted')))
    .limit(1)

  if (!deposit) {
    console.warn(`[snippe/payment webhook] Deposit not found or already processed: ${depositRequestId}`)
    return NextResponse.json({ status: 'ignored', reason: 'not_found_or_processed' })
  }

  if (type === 'payment.completed' && data.status === 'completed') {
    // Route to Safe approval if amount >= threshold
    const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'

    await db
      .update(depositRequests)
      .set({
        status: newStatus,
        pspReference: data.reference,
        pspChannel: data.channel?.provider,
        fiatConfirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(depositRequests.id, depositRequestId))

    console.log(`[snippe/payment webhook] Deposit ${depositRequestId} -> ${newStatus}`)
    return NextResponse.json({ status: 'success', depositId: depositRequestId, newStatus })
  }

  if (type === 'payment.failed' || data.status === 'failed') {
    await db
      .update(depositRequests)
      .set({
        status: 'rejected',
        pspReference: data.reference,
        updatedAt: new Date(),
      })
      .where(eq(depositRequests.id, depositRequestId))

    console.log(`[snippe/payment webhook] Deposit ${depositRequestId} -> rejected`, {
      reason: data.failure_reason,
    })
    return NextResponse.json({ status: 'success', depositId: depositRequestId, newStatus: 'rejected' })
  }

  return NextResponse.json({ status: 'acknowledged', type })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'snippe-payment-webhook' })
}
