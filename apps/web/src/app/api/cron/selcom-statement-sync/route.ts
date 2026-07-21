import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gt, isNull, ne, notInArray, or } from 'drizzle-orm'

import { isAuthorizedCron } from '@/lib/cron-auth'
import { getDb } from '@/lib/db'
import { writeAuditLog } from '@/lib/audit'
import { depositRequests, orphanPayments } from '@ntzs/db'
import { getStatement } from '@/lib/psp/selcom'
import {
  parseStatementRow,
  isWithinMatchWindow,
  ymdEAT,
  W2B_CHANNEL,
  W2B_MATCH_WINDOW_HOURS,
} from '@/lib/psp/selcom-statement'
import { getW2bConfig } from '@/lib/psp/selcom-w2b'
import { suggestOrphanMatch, samePhone } from '@/lib/deposits/orphan-match'

const SAFE_MINT_THRESHOLD_TZS = 1000000

export const maxDuration = 60

/**
 * GET /api/cron/selcom-statement-sync — settle w2b (Lipa Namba) deposits.
 *
 * W2B has no push and no callback: the user pays our Lipa Namba from their
 * own mobile-money menu. This cron is the ONLY settlement path:
 *
 *  1. INGEST — pull the Selcom account statement (yesterday+today, EAT) and
 *     park every credit as an orphan_payments row. Idempotent via the
 *     (provider, psp_reference) unique index; credits already tracked as
 *     push-USSD deposits are skipped. provider is a TEXT column, so ingest
 *     is safe even before drizzle/0061 (only deposit advancement needs the
 *     'selcom' enum value — and that sits behind the same flag as intent
 *     creation, which requires 0061 by definition).
 *
 *  2. AUTO-MATCH — attach an orphan to an open w2b intent ONLY when the
 *     match is beyond doubt: exactly one submitted SELCOM-W2B intent with the
 *     same amount AND payer phone, inside the 72h intent-first window, and no
 *     recent selcom push deposit with the same amount+phone (which would mean
 *     the credit might already be settling through pushussd-query — a second
 *     credit here would double-mint). Everything else stays 'unmatched' for
 *     the backstage orphan queue, where a human decides.
 *
 * Advancement mirrors attachOrphanAction: claim the orphan (conditional
 * update), advance the deposit (conditional update), release the claim if the
 * deposit was taken concurrently. Minting is left to process-mints.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!getW2bConfig()) {
      return NextResponse.json({ status: 'skipped', reason: 'SELCOM_W2B_ENABLED not set' })
    }

    const { db } = getDb()
    const now = new Date()

    // ── 1. Ingest statement credits into the orphan ledger ──────────────────
    let ingested = 0
    let alreadyKnown = 0
    let debits = 0
    const skipped: Record<string, number> = {}
    const warnings: string[] = []

    const statement = await getStatement({
      fromDate: ymdEAT(new Date(now.getTime() - 24 * 3600_000)),
      toDate: ymdEAT(now),
      perPage: 500,
      order: 'DESC',
    })

    if (statement.pagination?.lastPage && statement.pagination.lastPage > 1) {
      // No silent caps: page 2+ exists and the adapter has no page param yet.
      warnings.push(`statement has ${statement.pagination.lastPage} pages; only page 1 (500 rows) ingested this run`)
    }

    for (const row of statement.transactions) {
      const parsed = parseStatementRow(row)
      if (parsed.kind === 'debit') {
        debits++
        continue
      }
      if (parsed.kind === 'skipped') {
        skipped[parsed.reason] = (skipped[parsed.reason] ?? 0) + 1
        continue
      }

      // A credit whose reference is already a deposit's pspReference is a
      // push-USSD payment settling through its own path — not an orphan.
      const [known] = await db
        .select({ id: depositRequests.id })
        .from(depositRequests)
        .where(eq(depositRequests.pspReference, parsed.reference))
        .limit(1)
      if (known) {
        alreadyKnown++
        continue
      }

      const inserted = await db
        .insert(orphanPayments)
        .values({
          provider: 'selcom',
          pspReference: parsed.reference,
          eventType: 'statement.credit',
          amountTzs: parsed.amountTzs,
          payerPhone: parsed.payerPhone,
          payerName: parsed.payerName,
          channel: parsed.channel ?? 'SELCOM-STATEMENT',
          notes: parsed.narrative ? parsed.narrative.slice(0, 500) : null,
          receivedAt: parsed.occurredAt ?? now,
        })
        .onConflictDoNothing()
        .returning({ id: orphanPayments.id })
      if (inserted.length > 0) ingested++
    }

    // ── 2. Auto-match unmatched selcom orphans to open w2b intents ──────────
    let autoMatched = 0
    let deferredToManual = 0

    const unmatchedOrphans = await db
      .select()
      .from(orphanPayments)
      .where(and(eq(orphanPayments.provider, 'selcom'), eq(orphanPayments.status, 'unmatched')))
      .orderBy(desc(orphanPayments.receivedAt))
      .limit(100)

    if (unmatchedOrphans.length > 0) {
      const openIntents = await db
        .select({
          id: depositRequests.id,
          amountTzs: depositRequests.amountTzs,
          buyerPhone: depositRequests.buyerPhone,
          createdAt: depositRequests.createdAt,
        })
        .from(depositRequests)
        .where(
          and(
            eq(depositRequests.status, 'submitted'),
            eq(depositRequests.paymentProvider, 'selcom'),
            eq(depositRequests.pspChannel, W2B_CHANNEL)
          )
        )

      for (const orphan of unmatchedOrphans) {
        if (orphan.currency !== 'TZS') continue
        const paymentAt = orphan.receivedAt instanceof Date ? orphan.receivedAt : new Date(orphan.receivedAt)

        const eligible = openIntents.filter((intent) => {
          const createdAt = intent.createdAt instanceof Date ? intent.createdAt : new Date(intent.createdAt)
          return isWithinMatchWindow(createdAt, paymentAt)
        })

        const { exact } = suggestOrphanMatch(orphan, eligible)
        if (!exact) {
          if (eligible.length > 0) deferredToManual++
          continue
        }

        // Double-mint guard: a selcom PUSH deposit (any non-w2b channel) with
        // the same amount + phone in the window means this credit may already
        // be settling via pushussd-query — humans decide, not the matcher.
        const windowStart = new Date(paymentAt.getTime() - W2B_MATCH_WINDOW_HOURS * 3600_000)
        const pushSiblings = await db
          .select({ id: depositRequests.id, buyerPhone: depositRequests.buyerPhone })
          .from(depositRequests)
          .where(
            and(
              eq(depositRequests.paymentProvider, 'selcom'),
              or(isNull(depositRequests.pspChannel), ne(depositRequests.pspChannel, W2B_CHANNEL)),
              eq(depositRequests.amountTzs, orphan.amountTzs),
              gt(depositRequests.createdAt, windowStart),
              notInArray(depositRequests.status, ['rejected', 'cancelled'])
            )
          )
        if (pushSiblings.some((s) => samePhone(s.buyerPhone, orphan.payerPhone))) {
          deferredToManual++
          console.warn(
            `[cron/selcom-statement-sync] orphan ${orphan.id} deferred: selcom push deposit with same amount+phone in window`
          )
          continue
        }

        // Claim the orphan first so a concurrent manual attach can't double-credit.
        const claimed = await db
          .update(orphanPayments)
          .set({
            status: 'matched',
            matchedDepositRequestId: exact.id,
            reviewedAt: new Date(),
            notes: `${orphan.notes ? orphan.notes + ' | ' : ''}auto-matched by selcom-statement-sync`,
            updatedAt: new Date(),
          })
          .where(and(eq(orphanPayments.id, orphan.id), eq(orphanPayments.status, 'unmatched')))
          .returning({ id: orphanPayments.id })
        if (claimed.length === 0) continue

        const newStatus = exact.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'
        const advanced = await db
          .update(depositRequests)
          .set({
            status: newStatus,
            pspReference: orphan.pspReference,
            fiatConfirmedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(depositRequests.id, exact.id), eq(depositRequests.status, 'submitted')))
          .returning({ id: depositRequests.id })

        if (advanced.length === 0) {
          // Intent advanced/cancelled between select and update — release the claim.
          await db
            .update(orphanPayments)
            .set({ status: 'unmatched', matchedDepositRequestId: null, reviewedAt: null, updatedAt: new Date() })
            .where(and(eq(orphanPayments.id, orphan.id), eq(orphanPayments.status, 'matched')))
          continue
        }

        // The intent is settled — stop offering it to later orphans this run.
        const idx = openIntents.findIndex((i) => i.id === exact.id)
        if (idx >= 0) openIntents.splice(idx, 1)

        await writeAuditLog('deposit.orphan_auto_matched', 'deposit_request', exact.id, {
          orphanPaymentId: orphan.id,
          pspReference: orphan.pspReference,
          amountTzs: orphan.amountTzs,
          payerPhone: orphan.payerPhone,
          rule: 'single_exact_amount_phone_within_window',
          newStatus,
        })
        autoMatched++
        console.log(`[cron/selcom-statement-sync] orphan ${orphan.id} -> deposit ${exact.id} (${newStatus})`)
      }
    }

    return NextResponse.json({
      ingested,
      alreadyKnown,
      debits,
      skipped,
      autoMatched,
      deferredToManual,
      warnings,
      closingBalance: statement.closingBalance,
      timestamp: now.toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/selcom-statement-sync] Unhandled error:', msg)
    return NextResponse.json({ status: 'error', error: msg }, { status: 500 })
  }
}
