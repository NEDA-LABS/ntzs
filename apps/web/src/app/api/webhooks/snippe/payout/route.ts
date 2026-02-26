import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { verifyWebhookSignature, type SnippePayoutWebhookPayload } from '@/lib/psp/snippe'
import { burnRequests, auditLogs } from '@ntzs/db'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-webhook-signature') || ''
  const timestamp = request.headers.get('x-webhook-timestamp') || undefined

  // Verify HMAC signature
  if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
    console.error('[snippe/payout webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: SnippePayoutWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[snippe/payout webhook] Invalid JSON')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, data } = payload

  // Extract our burn_request_id from metadata
  const burnRequestId = data?.metadata?.burn_request_id as string
  if (!burnRequestId) {
    console.warn('[snippe/payout webhook] Missing burn_request_id in metadata')
    return NextResponse.json({ status: 'ignored', reason: 'no_burn_request_id' })
  }

  console.log(`[snippe/payout webhook] ${type} for burn ${burnRequestId}`, {
    reference: data.reference,
    status: data.status,
  })

  const { db } = getDb()

  // Fetch the burn request
  const [burn] = await db
    .select()
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (!burn) {
    console.warn(`[snippe/payout webhook] Burn request not found: ${burnRequestId}`)
    return NextResponse.json({ status: 'ignored', reason: 'not_found' })
  }

  // Idempotency: skip if payout already finalized
  if (burn.payoutStatus === 'completed' || burn.payoutStatus === 'failed') {
    console.warn(`[snippe/payout webhook] Already finalized: ${burnRequestId} (${burn.payoutStatus})`)
    return NextResponse.json({ status: 'ignored', reason: 'already_finalized' })
  }

  if (type === 'payout.completed' && data.status === 'completed') {
    await db
      .update(burnRequests)
      .set({
        payoutStatus: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))

    await db.insert(auditLogs).values({
      action: 'payout_completed',
      entityType: 'burn_request',
      entityId: burnRequestId,
      metadata: {
        payoutReference: data.reference,
        amountTzs: burn.amountTzs,
      },
    })

    console.log(`[snippe/payout webhook] Burn ${burnRequestId} payout completed`)
    return NextResponse.json({ status: 'success', burnId: burnRequestId, payoutStatus: 'completed' })
  }

  if (type === 'payout.failed' || data.status === 'failed') {
    await db
      .update(burnRequests)
      .set({
        payoutStatus: 'failed',
        payoutError: data.failure_reason || 'Payout failed',
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))

    await db.insert(auditLogs).values({
      action: 'payout_failed',
      entityType: 'burn_request',
      entityId: burnRequestId,
      metadata: {
        payoutReference: data.reference,
        amountTzs: burn.amountTzs,
        failureReason: data.failure_reason,
      },
    })

    console.log(`[snippe/payout webhook] Burn ${burnRequestId} payout failed`, {
      reason: data.failure_reason,
    })
    return NextResponse.json({ status: 'success', burnId: burnRequestId, payoutStatus: 'failed' })
  }

  return NextResponse.json({ status: 'acknowledged', type })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'snippe-payout-webhook' })
}
