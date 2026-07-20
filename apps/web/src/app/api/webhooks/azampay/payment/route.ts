import { and, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import {
  checkPaymentStatus,
  verifyWebhookSignature,
  type AzamPayPaymentWebhookPayload,
} from '@/lib/psp/azampay'
import { executeMint } from '@/lib/minting/executeMint'
import { depositRequests, merchantCollections } from '@ntzs/db'

const SAFE_MINT_THRESHOLD_TZS = 1000000

type Deposit = typeof depositRequests.$inferSelect

async function evidence(action: string, entityId: string, metadata: Record<string, unknown>) {
  try {
    const { sql } = getDb()
    await sql`
      insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
      values (${action}, 'psp_webhook', ${entityId}, ${JSON.stringify(metadata)}::jsonb, now())
    `
  } catch (err) {
    console.warn('[azampay/payment webhook] evidence insert failed:', err instanceof Error ? err.message : err)
  }
}

/** Claim-style advance (only from 'submitted') + instant mint. Returns the new status, or null if another path already claimed the deposit. */
async function advanceAndMint(
  deposit: Deposit,
  reference: string | null,
  channel: string | null
): Promise<string | null> {
  const { db } = getDb()
  const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'

  const updated = await db
    .update(depositRequests)
    .set({
      status: newStatus,
      pspReference: reference ?? deposit.pspReference,
      pspChannel: channel ?? deposit.pspChannel,
      fiatConfirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))
    .returning({ id: depositRequests.id })
  if (updated.length === 0) return null // raced by the poll cron — that path mints

  revalidatePath('/app/user')
  revalidatePath('/app/user/activity')

  if (newStatus === 'mint_pending') {
    after(async () => {
      const result = await executeMint(deposit.id)
      console.log(`[azampay/payment webhook] instant mint result for ${deposit.id}:`, result.status)
      if (result.status === 'minted') {
        revalidatePath('/app/user')
        revalidatePath('/app/user/activity')

        const { db: afterDb } = getDb()
        await afterDb
          .update(merchantCollections)
          .set({ collectionStatus: 'minted', updatedAt: new Date() })
          .where(
            and(
              eq(merchantCollections.depositRequestId, deposit.id),
              eq(merchantCollections.collectionStatus, 'pending')
            )
          )
      }
    })
  }
  return newStatus
}

/**
 * POST /api/webhooks/azampay/payment
 *
 * Trust model: AzamPay's production callback signature scheme is unconfirmed,
 * so a callback that fails our signature check is NOT rejected — it is treated
 * as a TRIGGER whose content is never believed. The deposit it points at is
 * re-verified against AzamPay's own status API (TQS, called with OUR bearer
 * credentials) and minted only on TQS-confirmed success — instant mints
 * without trusting unsigned input. A callback that DOES verify keeps the
 * original trusted path (payload drives the outcome, amount/currency checked).
 *
 * A reference can credit at most one deposit (uniqueness guard) — replaying a
 * real payment's reference against a second deposit cannot double-credit.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const headerNames = [...request.headers.keys()].sort()

  const signature = request.headers.get('x-webhook-signature') || ''
  const timestamp = request.headers.get('x-webhook-timestamp') || undefined
  const trusted = verifyWebhookSignature(rawBody, signature, timestamp)

  let payload: AzamPayPaymentWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[azampay/payment webhook] Invalid JSON', { headerNames })
    await evidence('psp.webhook_invalid', 'azampay/payment', {
      headerNames,
      bodyBytes: rawBody.length,
      reason: 'invalid_json',
    })
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!trusted) {
    // Header names (never values) still teach us their real signature scheme.
    console.warn('[azampay/payment webhook] unverified callback — trigger mode', { headerNames })
  }

  const str = (v: unknown): string | undefined => {
    if (typeof v === 'number') return String(v)
    if (typeof v !== 'string') return undefined
    const t = v.trim()
    return t !== '' && t.toLowerCase() !== 'null' ? t : undefined
  }

  const depositRequestId =
    str(payload.additionalProperties?.deposit_request_id) ?? str(payload.metadata?.deposit_request_id)
  const ourRef = str(payload.utilityref) ?? str(payload.externalId)
  const providerRefs = [str(payload.fspReferenceId), str(payload.reference), str(payload.transactionId)].filter(
    (v): v is string => Boolean(v)
  )
  const channel = str(payload.provider) ?? str(payload.operator)

  const { db } = getDb()

  // ── Locate the deposit: our echo → any reference → the initiation audit row ──
  let deposit: Deposit | undefined
  if (depositRequestId) {
    ;[deposit] = await db.select().from(depositRequests).where(eq(depositRequests.id, depositRequestId)).limit(1)
  }
  if (!deposit) {
    for (const ref of [ourRef, ...providerRefs].filter((v): v is string => Boolean(v))) {
      ;[deposit] = await db.select().from(depositRequests).where(eq(depositRequests.pspReference, ref)).limit(1)
      if (deposit) break
    }
  }
  if (!deposit && ourRef) {
    // Initiation writes a deposit.psp_initiated audit row carrying our
    // externalId — the id AzamPay echoes back as utilityref.
    try {
      const { sql } = getDb()
      const rows = await sql<Array<{ entity_id: string }>>`
        select entity_id from audit_logs
         where action = 'deposit.psp_initiated' and metadata->>'externalId' = ${ourRef}
         order by created_at desc limit 1
      `
      if (rows[0]?.entity_id) {
        ;[deposit] = await db.select().from(depositRequests).where(eq(depositRequests.id, rows[0].entity_id)).limit(1)
      }
    } catch {
      // best-effort lookup only
    }
  }

  if (!deposit) {
    console.warn('[azampay/payment webhook] no matching deposit', { depositRequestId, ourRef, providerRefs })
    await evidence('psp.webhook_unmatched', 'azampay/payment', {
      headerNames,
      depositRequestId: depositRequestId ?? null,
      ourRef: ourRef ?? null,
      providerRefs,
      trusted,
    })
    return NextResponse.json({ status: 'ignored', reason: 'no_matching_deposit' })
  }

  if (deposit.status !== 'submitted') {
    return NextResponse.json({ status: 'ignored', reason: 'already_processed' })
  }

  // ── TRUSTED: signature verified — the payload drives the outcome ──
  if (trusted) {
    const statusText = String(payload.transactionstatus ?? payload.status ?? '').toLowerCase()
    const isCompleted =
      statusText === 'success' || statusText === 'completed' || String(payload.type ?? '').includes('completed')
    const isFailed =
      statusText === 'failed' || statusText === 'failure' || String(payload.type ?? '').includes('failed')

    if (isCompleted) {
      const paidValue = Number(payload.amount ?? NaN)
      const paidCurrency = String(payload.currency ?? 'TZS').toUpperCase()
      if (paidCurrency !== 'TZS' || !Number.isFinite(paidValue) || Math.trunc(paidValue) < deposit.amountTzs) {
        console.error('[azampay/payment webhook] amount/currency mismatch', {
          depositId: deposit.id,
          expected: deposit.amountTzs,
          received: payload.amount,
          currency: paidCurrency,
        })
        await db
          .update(depositRequests)
          .set({ status: 'rejected', updatedAt: new Date() })
          .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))
        return NextResponse.json({ status: 'rejected', reason: 'amount_or_currency_mismatch' }, { status: 400 })
      }
      const newStatus = await advanceAndMint(deposit, providerRefs[0] ?? ourRef ?? null, channel ?? null)
      return NextResponse.json({ status: 'success', depositId: deposit.id, newStatus })
    }

    if (isFailed) {
      await db
        .update(depositRequests)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))
      revalidatePath('/app/user')
      return NextResponse.json({ status: 'success', depositId: deposit.id, newStatus: 'rejected' })
    }

    return NextResponse.json({ status: 'acknowledged', statusValue: payload.status ?? payload.transactionstatus })
  }

  // ── TRIGGER: verify via TQS before believing anything ──
  const candidates = [
    ...new Set([deposit.pspReference, ...providerRefs, ourRef].filter((v): v is string => Boolean(v))),
  ]
  for (const candidate of candidates) {
    const status = await checkPaymentStatus(candidate, deposit.pspChannel ?? channel ?? undefined)

    if (status.status === 'completed') {
      if (candidate !== deposit.pspReference) {
        const [taken] = await db
          .select({ id: depositRequests.id })
          .from(depositRequests)
          .where(and(eq(depositRequests.pspReference, candidate), ne(depositRequests.id, deposit.id)))
          .limit(1)
        if (taken) {
          await evidence('psp.webhook_ref_conflict', deposit.id, { candidate, conflictingDeposit: taken.id })
          continue
        }
      }
      const newStatus = await advanceAndMint(deposit, candidate, deposit.pspChannel ?? channel ?? null)
      await evidence('deposit.callback_confirmed', deposit.id, {
        candidate,
        verifiedVia: 'tqs',
        trusted: false,
        newStatus,
      })
      console.log(`[azampay/payment webhook] trigger-verified ${deposit.id} via ${candidate} -> ${newStatus}`)
      return NextResponse.json({ status: 'success', depositId: deposit.id, newStatus })
    }

    if (status.status === 'failed' || status.status === 'expired') {
      await db
        .update(depositRequests)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))
      await evidence('deposit.callback_confirmed', deposit.id, {
        candidate,
        verifiedVia: 'tqs',
        outcome: 'rejected',
      })
      revalidatePath('/app/user')
      return NextResponse.json({ status: 'success', depositId: deposit.id, newStatus: 'rejected' })
    }
  }

  // Nothing confirmed — leave it to the poll cron; keep their retries flowing.
  await evidence('psp.webhook_unconfirmed', deposit.id, { headerNames, candidates, trusted: false })
  return NextResponse.json({ status: 'accepted', result: 'unconfirmed_pending_poll' })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'azampay-payment-webhook' })
}
