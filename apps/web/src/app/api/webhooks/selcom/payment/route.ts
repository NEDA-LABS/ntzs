import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { checkPaymentStatus } from '@/lib/psp/selcom'
import { executeMint } from '@/lib/minting/executeMint'
import { depositRequests } from '@ntzs/db'

const SAFE_MINT_THRESHOLD_TZS = 1000000

/**
 * Selcom collection (push-USSD) callback.
 *
 * Same confirm-by-poll trust model as the payout webhook and the AzamPay
 * trigger-verify path: Selcom callbacks are UNSIGNED, so the body is only a
 * hint — the deposit it points at is re-verified via our RSA-signed
 * pushussd-query before anything mints. A forged callback can at worst
 * trigger a status poll.
 *
 * Gated on SELCOM_COLLECTIONS_ENABLED: before the rail is live (and before
 * drizzle/0061 adds the 'selcom' enum value) this route acknowledges and
 * does nothing, so stray calls can't error against the database.
 */
export async function POST(request: NextRequest) {
  if (process.env.SELCOM_COLLECTIONS_ENABLED !== 'true') {
    return NextResponse.json({ received: true, ignored: 'selcom collections not enabled' })
  }

  let payload: Record<string, unknown>
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const str = (v: unknown): string | undefined => {
    if (typeof v === 'number') return String(v)
    if (typeof v !== 'string') return undefined
    const t = v.trim()
    return t !== '' ? t : undefined
  }
  // Our transId is the reference we stored at initiation; Selcom may echo it
  // as reference_id / transId / trans_id depending on the callback template.
  const reference = str(payload.reference_id) ?? str(payload.transId) ?? str(payload.trans_id)
  if (!reference) {
    return NextResponse.json({ received: true, ignored: 'no reference' })
  }

  const { db } = getDb()
  const [deposit] = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.pspReference, reference))
    .limit(1)

  if (!deposit) {
    console.warn('[selcom/payment webhook] no deposit for reference', { reference })
    return NextResponse.json({ received: true, ignored: 'unknown reference' })
  }
  if (deposit.status !== 'submitted') {
    return NextResponse.json({ received: true, ignored: 'already processed' })
  }

  // Authoritative status via our signed query — never the callback body.
  const confirmed = await checkPaymentStatus(reference)

  if (confirmed.status === 'completed') {
    const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'
    const claimed = await db
      .update(depositRequests)
      .set({ status: newStatus, fiatConfirmedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))
      .returning({ id: depositRequests.id })

    if (claimed.length > 0) {
      revalidatePath('/app/user')
      revalidatePath('/app/user/activity')
      if (newStatus === 'mint_pending') {
        after(async () => {
          const result = await executeMint(deposit.id)
          console.log(`[selcom/payment webhook] instant mint result for ${deposit.id}:`, result.status)
        })
      }
      console.log(`[selcom/payment webhook] deposit ${deposit.id} -> ${newStatus} (confirmed by query)`)
    }
    return NextResponse.json({ received: true, depositId: deposit.id, newStatus })
  }

  if (confirmed.status === 'failed' || confirmed.status === 'expired') {
    await db
      .update(depositRequests)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))
    revalidatePath('/app/user')
    return NextResponse.json({ received: true, depositId: deposit.id, newStatus: 'rejected' })
  }

  // pending/unresolved — the poll-selcom cron keeps watching.
  return NextResponse.json({ received: true, result: 'unconfirmed_pending_poll' })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'selcom-payment-webhook' })
}
