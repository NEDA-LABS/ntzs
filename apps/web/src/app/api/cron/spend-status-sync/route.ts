import { NextRequest, NextResponse } from 'next/server'
import { eq, and, or, lt, isNotNull, inArray, desc } from 'drizzle-orm'

import { isAuthorizedCron } from '@/lib/cron-auth'
import { getDb } from '@/lib/db'
import { burnRequests, wallets } from '@ntzs/db'
import { queryTransactionRaw } from '@/lib/psp/selcom'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'
import { writeAuditLog } from '@/lib/audit'
import { spendEnabled } from '@/lib/waas/spend-quote'

export const maxDuration = 60

/**
 * GET /api/cron/spend-status-sync — settle in-flight spend rows.
 *
 * The execute route polls for ~20s; anything still 'pending' after that is
 * advanced here from the authoritative /v1/transaction/query:
 *   COMPLETED → payout completed + settlement evidence (actual charges,
 *               Selcom receipt) stamped into the spend descriptor
 *   FAILED    → claim-once revert (re-mint the user; fee handling identical
 *               to the withdrawal webhooks)
 *   else      → stays pending (next run)
 *
 * Gated on SELCOM_SPEND_ENABLED — before the rails are live (and before
 * drizzle/0064) the cron no-ops, so the new columns are never referenced
 * against a database that doesn't have them.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!spendEnabled()) {
      return NextResponse.json({ status: 'skipped', reason: 'SELCOM_SPEND_ENABLED not set' })
    }

    const { db } = getDb()
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)

    const pending = await db
      .select({
        id: burnRequests.id,
        amountTzs: burnRequests.amountTzs,
        platformFeeTzs: burnRequests.platformFeeTzs,
        feeTxHash: burnRequests.feeTxHash,
        feeRecipientAddress: burnRequests.feeRecipientAddress,
        payoutReference: burnRequests.payoutReference,
        spend: burnRequests.spend,
        walletAddress: wallets.address,
      })
      .from(burnRequests)
      .innerJoin(wallets, eq(burnRequests.walletId, wallets.id))
      .where(
        and(
          inArray(burnRequests.payoutKind, ['lipa', 'bill']),
          eq(burnRequests.payoutStatus, 'pending'),
          lt(burnRequests.updatedAt, thirtySecondsAgo),
          isNotNull(burnRequests.payoutReference)
        )
      )
      // Newest first — a stuck backlog must never starve fresh spends.
      .orderBy(desc(burnRequests.createdAt))
      .limit(25)

    const results: Array<{ id: string; outcome: string }> = []

    for (const row of pending) {
      if (!row.payoutReference) continue
      try {
        const raw = await queryTransactionRaw(row.payoutReference)
        if ('error' in raw) {
          results.push({ id: row.id, outcome: 'query_error' })
          continue
        }
        const status = String(raw.body.data?.status ?? '').toUpperCase()

        if (status === 'COMPLETED' || raw.body.result === 'SUCCESS') {
          const d = raw.body.data as Record<string, unknown> | undefined
          const descriptor = (row.spend ?? {}) as Record<string, unknown>
          await db
            .update(burnRequests)
            .set({
              status: 'burned',
              payoutStatus: 'completed',
              spend: {
                ...descriptor,
                actualChargesTzs: d?.totalCharges != null ? Number(d.totalCharges) : descriptor.actualChargesTzs,
                selcomReceipt: typeof d?.selcomReceipt === 'string' ? d.selcomReceipt : descriptor.selcomReceipt,
              },
              updatedAt: new Date(),
            })
            .where(and(eq(burnRequests.id, row.id), eq(burnRequests.payoutStatus, 'pending')))
          results.push({ id: row.id, outcome: 'completed' })
          console.log(`[cron/spend-status-sync] spend ${row.id} completed (${row.payoutReference})`)
          continue
        }

        if (status === 'FAILED' || raw.body.result === 'FAIL') {
          // Claim-once revert — same discipline as the payout webhooks.
          const claim = await db
            .update(burnRequests)
            .set({ payoutStatus: 'reverting', updatedAt: new Date() })
            .where(
              and(
                eq(burnRequests.id, row.id),
                or(eq(burnRequests.payoutStatus, 'pending'), eq(burnRequests.payoutStatus, 'failed'))
              )
            )
            .returning({ id: burnRequests.id })
          if (claim.length === 0) {
            results.push({ id: row.id, outcome: 'revert_already_claimed' })
            continue
          }

          const res = await revertOffRampBurn({
            burnRequestId: row.id,
            userAddress: row.walletAddress,
            burnAmountTzs: row.amountTzs,
            platformFeeTzs: row.platformFeeTzs,
            feeRecipientAddress: row.feeRecipientAddress,
            feeMintOccurred: Boolean(row.feeTxHash),
            reason: 'Selcom payment failed (spend-status-sync)',
          })
          await db
            .update(burnRequests)
            .set({
              status: 'failed',
              payoutStatus: res.error ? 'reconcile_required' : 'reverted',
              payoutError: res.error
                ? `Selcom payment failed | remint_error: ${res.error}`
                : 'Selcom payment failed (spend-status-sync)',
              updatedAt: new Date(),
            })
            .where(eq(burnRequests.id, row.id))

          await writeAuditLog('spend.reverted', 'burn_request', row.id, {
            payoutReference: row.payoutReference,
            amountTzs: row.amountTzs,
            remintError: res.error ?? null,
          })
          results.push({ id: row.id, outcome: res.error ? 'reconcile_required' : 'reverted' })
          console.warn(`[cron/spend-status-sync] spend ${row.id} failed → ${res.error ? 'reconcile_required' : 'reverted'}`)
          continue
        }

        results.push({ id: row.id, outcome: 'still_pending' })
      } catch (err) {
        console.error(`[cron/spend-status-sync] error on ${row.id}:`, err instanceof Error ? err.message : err)
        results.push({ id: row.id, outcome: 'error' })
      }
    }

    return NextResponse.json({ processed: results.length, results, timestamp: new Date().toISOString() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/spend-status-sync] Unhandled error:', msg)
    return NextResponse.json({ status: 'error', error: msg }, { status: 500 })
  }
}
