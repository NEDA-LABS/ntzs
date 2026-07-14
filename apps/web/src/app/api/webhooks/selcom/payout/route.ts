import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { burnRequests, auditLogs } from '@ntzs/db'
import { confirmPayout, type SelcomPayoutWebhookPayload } from '@/lib/psp/selcom'

/**
 * Selcom disbursement callback.
 *
 * SECURITY MODEL — confirm-by-poll: Selcom callbacks are UNSIGNED, so the
 * payload is treated as a hint only. Nothing is trusted from the body except
 * the reference used to LOOK UP our own record; the authoritative status comes
 * from `confirmPayout` (GET /v1/transaction/query, RSA-signed by us). A forged
 * callback can therefore at worst trigger a status poll.
 *
 * Selcom also only calls back on SUCCESS (never on failure), so this handler
 * is an accelerator — the poll-selcom cron is the primary completion/failure
 * detection path.
 *
 * TODO(phase-1): add Selcom callback source-IP allowlist in middleware once
 * Selcom publishes their egress IPs.
 *
 * Expected response: 200 {"received": true}.
 */
export async function POST(request: NextRequest) {
  let payload: SelcomPayoutWebhookPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const referenceId = payload?.reference_id
  if (!referenceId || typeof referenceId !== 'string') {
    return NextResponse.json({ received: true, ignored: 'no reference_id' })
  }

  const { db } = getDb()

  // Look up by OUR stamped record — reference + provider must both match.
  const [burn] = await db
    .select({
      id: burnRequests.id,
      payoutStatus: burnRequests.payoutStatus,
      amountTzs: burnRequests.amountTzs,
    })
    .from(burnRequests)
    .where(and(eq(burnRequests.payoutReference, referenceId), eq(burnRequests.payoutProvider, 'selcom')))
    .limit(1)

  if (!burn) {
    console.warn('[selcom/payout webhook] no selcom burn for reference', { referenceId })
    return NextResponse.json({ received: true, ignored: 'unknown reference' })
  }

  // Idempotency: already finalized → ack and stop (replay becomes a no-op).
  if (burn.payoutStatus !== 'pending') {
    return NextResponse.json({ received: true, ignored: `already ${burn.payoutStatus}` })
  }

  // Authoritative status via our signed query — never the callback body.
  const confirmed = await confirmPayout(referenceId)

  if (confirmed.status === 'completed') {
    await db
      .update(burnRequests)
      .set({ payoutStatus: 'completed', status: 'burned', updatedAt: new Date() })
      .where(and(eq(burnRequests.id, burn.id), eq(burnRequests.payoutStatus, 'pending')))

    await db.insert(auditLogs).values({
      action: 'payout_completed',
      entityType: 'burn_request',
      entityId: burn.id,
      metadata: { payoutReference: referenceId, amountTzs: burn.amountTzs, provider: 'selcom', via: 'webhook+confirm' },
    })
    console.log('[selcom/payout webhook] payout confirmed completed', { burnId: burn.id, referenceId })
  } else if (confirmed.status === 'failed') {
    // Conservative: flag for the reconcile flow rather than auto-reverting
    // from a webhook context. The admin reconcile route (or poll-selcom)
    // completes the revert with full paper trail.
    await db
      .update(burnRequests)
      .set({ payoutStatus: 'reconcile_required', payoutError: confirmed.failureReason ?? 'Payout failed (confirmed by query)', updatedAt: new Date() })
      .where(and(eq(burnRequests.id, burn.id), eq(burnRequests.payoutStatus, 'pending')))
    console.error('[selcom/payout webhook] payout FAILED on confirm', { burnId: burn.id, referenceId, reason: confirmed.failureReason })
  } else {
    // pending/unknown — leave for the poller; ack so Selcom doesn't retry forever.
    console.log('[selcom/payout webhook] not yet conclusive on confirm', { burnId: burn.id, status: confirmed.status })
  }

  return NextResponse.json({ received: true })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'selcom-payout-webhook' })
}
