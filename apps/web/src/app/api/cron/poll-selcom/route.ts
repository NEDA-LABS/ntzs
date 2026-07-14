import { NextRequest, NextResponse } from 'next/server'
import { eq, and, lt, isNotNull } from 'drizzle-orm'

import { isAuthorizedCron } from '@/lib/cron-auth'
import { getDb } from '@/lib/db'
import { burnRequests } from '@ntzs/db'
import { checkPayoutStatus, ADAPTERS } from '@/lib/psp'

export const maxDuration = 60

/**
 * GET /api/cron/poll-selcom — reconcile pending Selcom payouts.
 *
 * MANDATORY for Selcom (not just a webhook fallback): Selcom callbacks fire
 * ONLY on success, so a failed disbursement is discovered exclusively by
 * polling GET /v1/transaction/query. Failures are flagged reconcile_required
 * (conservative — the admin reconcile route completes the revert with a full
 * paper trail).
 *
 * Phase 1 extension: also reconcile pending Selcom DEPOSITS here once
 * collections ship (payment_provider = 'selcom').
 */
export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!ADAPTERS.selcom.isConfigured()) {
      return NextResponse.json({ status: 'skipped', reason: 'Selcom credentials not configured' })
    }

    const { db } = getDb()
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)

    const pending = await db
      .select({
        id: burnRequests.id,
        payoutReference: burnRequests.payoutReference,
        amountTzs: burnRequests.amountTzs,
      })
      .from(burnRequests)
      .where(
        and(
          eq(burnRequests.payoutProvider, 'selcom'),
          eq(burnRequests.payoutStatus, 'pending'),
          isNotNull(burnRequests.payoutReference),
          lt(burnRequests.updatedAt, thirtySecondsAgo),
        ),
      )
      .orderBy(burnRequests.updatedAt)
      .limit(10)

    const results: Array<{ burnId: string; status: string }> = []

    for (const burn of pending) {
      if (!burn.payoutReference) continue
      try {
        const ps = await checkPayoutStatus(burn.payoutReference, 'selcom')

        if (ps.status === 'completed') {
          await db
            .update(burnRequests)
            .set({ payoutStatus: 'completed', status: 'burned', updatedAt: new Date() })
            .where(and(eq(burnRequests.id, burn.id), eq(burnRequests.payoutStatus, 'pending')))
          results.push({ burnId: burn.id, status: 'completed' })
          console.log(`[cron/poll-selcom] burn ${burn.id} payout completed`)
        } else if (ps.status === 'failed' || ps.status === 'reversed') {
          await db
            .update(burnRequests)
            .set({
              payoutStatus: 'reconcile_required',
              payoutError: ps.failureReason ?? `Payout ${ps.status} (polled)`,
              updatedAt: new Date(),
            })
            .where(and(eq(burnRequests.id, burn.id), eq(burnRequests.payoutStatus, 'pending')))
          results.push({ burnId: burn.id, status: 'reconcile_required' })
          console.error(`[cron/poll-selcom] burn ${burn.id} payout ${ps.status} — flagged for reconcile`, { reason: ps.failureReason })
        } else {
          results.push({ burnId: burn.id, status: ps.status })
        }
      } catch (err) {
        console.error(`[cron/poll-selcom] error polling ${burn.id}:`, err instanceof Error ? err.message : err)
        results.push({ burnId: burn.id, status: 'error' })
      }
    }

    return NextResponse.json({ processed: results.length, results, timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('[cron/poll-selcom] Unhandled error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
