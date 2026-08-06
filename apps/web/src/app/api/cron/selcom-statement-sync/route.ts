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
  BANK_CHANNEL,
  suggestBankMatch,
  bankReferenceInText,
  formatBankReference,
} from '@/lib/psp/selcom-statement'
import { getW2bConfig, getBankCollectionConfig } from '@/lib/psp/selcom-w2b'
import { suggestOrphanMatch, samePhone } from '@/lib/deposits/orphan-match'
import { SAFE_MINT_THRESHOLD_TZS } from '@/lib/approvals/thresholds'


// A single statement page costs ~30s on the live account (measured 5 Aug
// 2026), so the old 60s budget could not fit even two pages — and a run that
// overruns is killed, discarding everything it had already matched.
export const maxDuration = 300

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
 *  3. BANK MATCH — attach a still-unmatched orphan to an open SELCOM-BANK
 *     intent when exactly one open intent's reference token appears in the
 *     credit's free text AND the amount is exact, inside the same window.
 *     Bank/TIPS credits carry no payer phone; the token is the identity.
 *     Token-found-but-wrong-amount stays 'unmatched' — a human decides.
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

    // Either statement-settled channel keeps the cron alive — bank-transfer
    // collections must not silently stop settling if Lipa Namba is turned off.
    if (!getW2bConfig() && !getBankCollectionConfig()) {
      return NextResponse.json({
        status: 'skipped',
        reason: 'neither SELCOM_W2B_ENABLED nor SELCOM_BANK_COLLECTIONS_ENABLED is set',
      })
    }

    const { db } = getDb()
    const now = new Date()
    const startedAt = Date.now()

    // TEMP diagnostic (5 Aug 2026): the live statement fetch times out and the
    // sandbox account this repo's env points at is empty, so the only way to
    // find parameters that return in time is to probe production. Read-only —
    // fetches and reports timing, never touches the ledger.
    const probe = request.nextUrl.searchParams.get('probe')
    if (probe) {
      const perPage = Number(request.nextUrl.searchParams.get('perPage') ?? 50)
      const days = Number(request.nextUrl.searchParams.get('days') ?? 0)
      const preset = request.nextUrl.searchParams.get('preset') ?? undefined
      const t0 = Date.now()
      try {
        const s = await getStatement(
          preset
            ? { preset, perPage, page: 1 }
            : {
                fromDate: ymdEAT(new Date(now.getTime() - days * 24 * 3600_000)),
                toDate: ymdEAT(now),
                perPage,
                page: 1,
              },
        )
        // Does the payer's reference actually survive the transfer? Show the
        // raw keys and the parsed credit fields the matcher searches, plus
        // whether any open bank intent's token is found in them.
        const openIntents = await db
          .select({ id: depositRequests.id, reference: depositRequests.pspReference, amountTzs: depositRequests.amountTzs })
          .from(depositRequests)
          .where(and(eq(depositRequests.pspChannel, BANK_CHANNEL), eq(depositRequests.status, 'submitted')))
          .limit(20)

        const rows = s.transactions.map((row) => {
          const parsed = parseStatementRow(row)
          // Raw row included deliberately: this is our own settlement account,
          // the caller is cron-authenticated, and the parse failure can only be
          // diagnosed from the actual values Selcom sends.
          const base = { keys: Object.keys(row), raw: row }
          if (parsed.kind !== 'credit') return { ...base, kind: parsed.kind, reason: 'reason' in parsed ? parsed.reason : null }
          const searched = [parsed.reference, parsed.narrative, parsed.payerName]
          return {
            ...base,
            kind: 'credit' as const,
            amountTzs: parsed.amountTzs,
            reference: parsed.reference,
            narrative: parsed.narrative,
            payerName: parsed.payerName,
            tokenHit: openIntents
              .filter((i) => i.reference && searched.some((f) => bankReferenceInText(i.reference!, f)))
              .map((i) => ({ token: i.reference, amountMatches: i.amountTzs === parsed.amountTzs })),
          }
        })

        return NextResponse.json({
          probe: true,
          ms: Date.now() - t0,
          params: { perPage, days, preset: preset ?? null },
          // Which account are we actually reading? If the statement account is
          // not the account payers are told to send to, no credit can ever be
          // seen — regardless of references or timeouts.
          statementAccount: { number: s.accountNumber ?? null, name: s.accountName ?? null },
          collectionAccount: getBankCollectionConfig()?.accountNumber ?? null,
          rowCount: s.transactions.length,
          closingBalance: s.closingBalance,
          openIntents: openIntents.map((i) => ({ token: i.reference, amountTzs: i.amountTzs })),
          rows,
        })
      } catch (e) {
        return NextResponse.json({ probe: true, ms: Date.now() - t0, params: { perPage, days, preset: preset ?? null }, error: (e as Error).message })
      }
    }

    // ── 1. Ingest statement credits into the orphan ledger ──────────────────
    let ingested = 0
    let alreadyKnown = 0
    let debits = 0
    const skipped: Record<string, number> = {}
    const warnings: string[] = []

    // 500 rows/page made every run on the live account exceed the statement
    // client's timeout, so nothing was ever ingested and no bank deposit ever
    // auto-credited (5 Aug 2026). Smaller pages return quickly; rows are
    // ordered DESC, so page 1 alone covers everything a 5-minute cron needs
    // and deeper pages only matter when catching up after an outage.
    const PER_PAGE = 100
    const MAX_PAGES = 5
    // Stop fetching well before maxDuration: at ~30s a page, another fetch
    // started late would run past the function limit, and an overrun kills the
    // run — discarding the matching that the fetched pages already earned.
    const PAGE_BUDGET_MS = 150_000
    const range = {
      fromDate: ymdEAT(new Date(now.getTime() - 24 * 3600_000)),
      toDate: ymdEAT(now),
      perPage: PER_PAGE,
      order: 'DESC' as const,
    }

    const statement = await getStatement({ ...range, page: 1 })
    const transactions = [...statement.transactions]
    const lastPage = statement.pagination?.lastPage ?? 1
    let pagesRead = 1
    for (let page = 2; page <= Math.min(lastPage, MAX_PAGES); page++) {
      if (Date.now() - startedAt > PAGE_BUDGET_MS) {
        warnings.push(`page budget reached after ${pagesRead} page(s); remainder picked up next run`)
        break
      }
      const next = await getStatement({ ...range, page })
      pagesRead++
      if (next.transactions.length === 0) break
      transactions.push(...next.transactions)
    }
    if (lastPage > MAX_PAGES) {
      // No silent caps: an unread tail exists beyond the per-run page budget.
      warnings.push(
        `statement has ${lastPage} pages; only ${MAX_PAGES} (${MAX_PAGES * PER_PAGE} rows) ingested this run — remainder picked up next run`
      )
    }

    for (const row of transactions) {
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
    // Orphans this run already claimed (pass 2) — pass 3 skips them without
    // re-reading; its conditional claim still protects against races.
    const claimedOrphanIds = new Set<string>()

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
        claimedOrphanIds.add(orphan.id)

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

    // ── 3. Bank-transfer match: reference token + exact amount ──────────────
    let bankMatched = 0
    let bankDeferredToManual = 0

    const bankCandidateOrphans = unmatchedOrphans.filter((o) => !claimedOrphanIds.has(o.id))
    if (bankCandidateOrphans.length > 0) {
      const openBankIntents = (
        await db
          .select({
            id: depositRequests.id,
            amountTzs: depositRequests.amountTzs,
            pspReference: depositRequests.pspReference,
            createdAt: depositRequests.createdAt,
          })
          .from(depositRequests)
          .where(
            and(
              eq(depositRequests.status, 'submitted'),
              eq(depositRequests.paymentProvider, 'selcom'),
              eq(depositRequests.pspChannel, BANK_CHANNEL)
            )
          )
      ).flatMap((i) =>
        i.pspReference ? [{ id: i.id, amountTzs: i.amountTzs, reference: i.pspReference, createdAt: i.createdAt }] : []
      )

      for (const orphan of bankCandidateOrphans) {
        if (openBankIntents.length === 0) break
        if (orphan.currency !== 'TZS') continue
        const paymentAt = orphan.receivedAt instanceof Date ? orphan.receivedAt : new Date(orphan.receivedAt)

        const eligible = openBankIntents.filter((intent) => {
          const createdAt = intent.createdAt instanceof Date ? intent.createdAt : new Date(intent.createdAt)
          return isWithinMatchWindow(createdAt, paymentAt)
        })

        // Banks are inconsistent about WHERE the sender's narration surfaces,
        // so the token is searched across every free-text field we ingested.
        const { exact, candidates } = suggestBankMatch(
          { amountTzs: orphan.amountTzs, fields: [orphan.notes, orphan.payerName, orphan.pspReference] },
          eligible
        )
        if (!exact) {
          if (candidates.length > 0) {
            // Token seen but amount wrong (or a token collision): a human
            // decides from the orphan queue — never auto-credit a guess.
            bankDeferredToManual++
            console.warn(
              `[cron/selcom-statement-sync] orphan ${orphan.id} carries bank reference of intent(s) ${candidates
                .map((c) => c.id)
                .join(', ')} but no exact amount match (credit ${orphan.amountTzs}) — manual review`
            )
          }
          continue
        }

        // Claim the orphan first so a concurrent manual attach can't double-credit.
        const claimed = await db
          .update(orphanPayments)
          .set({
            status: 'matched',
            matchedDepositRequestId: exact.id,
            reviewedAt: new Date(),
            notes: `${orphan.notes ? orphan.notes + ' | ' : ''}auto-matched by selcom-statement-sync (bank reference ${formatBankReference(exact.reference)})`,
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
            ...(orphan.payerName ? { payerName: orphan.payerName } : {}),
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
        const idx = openBankIntents.findIndex((i) => i.id === exact.id)
        if (idx >= 0) openBankIntents.splice(idx, 1)

        await writeAuditLog('deposit.bank_intent_auto_matched', 'deposit_request', exact.id, {
          orphanPaymentId: orphan.id,
          pspReference: orphan.pspReference,
          bankReference: exact.reference,
          amountTzs: orphan.amountTzs,
          payerName: orphan.payerName,
          rule: 'bank_reference_exact_amount_within_window',
          newStatus,
        })
        bankMatched++
        console.log(`[cron/selcom-statement-sync] orphan ${orphan.id} -> bank deposit ${exact.id} (${newStatus})`)
      }
    }

    return NextResponse.json({
      ingested,
      alreadyKnown,
      debits,
      skipped,
      autoMatched,
      deferredToManual,
      bankMatched,
      bankDeferredToManual,
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
