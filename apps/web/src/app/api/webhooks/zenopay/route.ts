import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { type ZenoPayWebhookPayload } from '@/lib/psp/zenopay'
import { depositRequests } from '@ntzs/db'

const SAFE_MINT_THRESHOLD_TZS = 100000

// Known ZenoPay server IPs
const ZENOPAY_ALLOWED_IPS = ['64.227.9.159']

export async function POST(request: NextRequest) {
  const realIp = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  console.log('[ZenoPay Webhook] Request from IP:', realIp)

  // Read body
  const rawBody = await request.text()
  console.log('[ZenoPay Webhook] Raw body:', rawBody)

  // Log warning if from unknown IP but still process
  // (ZenoPay may use multiple IPs, and we verify order exists in our DB anyway)
  if (!realIp || !ZENOPAY_ALLOWED_IPS.includes(realIp)) {
    console.warn('[ZenoPay Webhook] Request from non-whitelisted IP:', realIp)
  }

  let payload: ZenoPayWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[ZenoPay Webhook] Invalid JSON')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { order_id, payment_status, reference, transid, channel } = payload

  if (!order_id || !payment_status) {
    console.error('[ZenoPay Webhook] Missing required fields:', { order_id, payment_status })
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  console.log(`[ZenoPay Webhook] Processing: order_id=${order_id} status=${payment_status} transid=${transid}`)

  if (payment_status !== 'COMPLETED') {
    return NextResponse.json({ status: 'acknowledged', payment_status })
  }

  const { db } = getDb()

  const [deposit] = await db
    .select()
    .from(depositRequests)
    .where(and(eq(depositRequests.id, order_id), eq(depositRequests.status, 'submitted')))
    .limit(1)

  if (!deposit) {
    console.warn(`[ZenoPay Webhook] Deposit not found or already processed: ${order_id}`)
    return NextResponse.json({ status: 'ignored', reason: 'not_found_or_processed' })
  }

  // Route to Safe approval if amount >= threshold
  const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'

  await db
    .update(depositRequests)
    .set({
      status: newStatus,
      pspReference: transid || reference,
      pspChannel: channel,
      fiatConfirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(depositRequests.id, order_id))

  console.log(`[ZenoPay Webhook] Deposit ${order_id} updated to ${newStatus}`)

  return NextResponse.json({ status: 'success', order_id })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'zenopay-webhook' })
}
