import { NextRequest, NextResponse } from 'next/server'
import { eq, and, lt, isNotNull, inArray, desc } from 'drizzle-orm'

import { isAuthorizedCron } from '@/lib/cron-auth'
import { getDb } from '@/lib/db'
import { depositRequests } from '@ntzs/db'
import { checkPaymentStatus } from '@/lib/psp/selcom'

const SAFE_MINT_THRESHOLD_TZS = 1000000

export const maxDuration = 60

/**
 * GET /api/cron/poll-selcom — reconcile pending Selcom push-USSD deposits.
 *
 * MANDATORY for Selcom (not just a webhook fallback): their callbacks fire
 * ONLY on success, so failures/expiries are discovered exclusively by polling
 * pushussd-query.
 *
 * Gated on SELCOM_COLLECTIONS_ENABLED — before the rail is live (and before
 * drizzle/0061 adds the 'selcom' enum value) the cron no-ops, so the enum
 * literal in the WHERE clause can never error against the database.
 *
 * Payout reconciliation joins here at disbursement go-live, once the
 * payout_provider stamp (drizzle/0061) is adopted by the burn engine.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (process.env.SELCOM_COLLECTIONS_ENABLED !== 'true') {
      return NextResponse.json({ status: 'skipped', reason: 'SELCOM_COLLECTIONS_ENABLED not set' })
    }

    const { db } = getDb()
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)

    const pendingDeposits = await db
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
          inArray(depositRequests.paymentProvider, ['selcom']),
          lt(depositRequests.createdAt, thirtySecondsAgo),
          isNotNull(depositRequests.pspReference),
        )
      )
      // Newest first — the AzamPay poll-starvation lesson: a stuck backlog
      // must never occupy every slot and starve fresh deposits.
      .orderBy(desc(depositRequests.createdAt))
      .limit(25)

    const results: Array<{ depositId: string; status: string }> = []

    for (const deposit of pendingDeposits) {
      if (!deposit.pspReference) continue
      try {
        const st = await checkPaymentStatus(deposit.pspReference)

        if (st.status === 'completed') {
          const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'
          await db
            .update(depositRequests)
            .set({ status: newStatus, fiatConfirmedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))
          results.push({ depositId: deposit.id, status: newStatus })
          console.log(`[cron/poll-selcom] Deposit ${deposit.id} -> ${newStatus}`)
        } else if (st.status === 'failed' || st.status === 'expired') {
          await db
            .update(depositRequests)
            .set({ status: 'rejected', updatedAt: new Date() })
            .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))
          results.push({ depositId: deposit.id, status: 'rejected' })
          console.log(`[cron/poll-selcom] Deposit ${deposit.id} -> rejected (${st.status})`)
        } else {
          results.push({ depositId: deposit.id, status: 'pending' })
        }
      } catch (err) {
        console.error(`[cron/poll-selcom] Error polling ${deposit.id}:`, err instanceof Error ? err.message : err)
        results.push({ depositId: deposit.id, status: 'error' })
      }
    }

    return NextResponse.json({ processed: results.length, results, timestamp: new Date().toISOString() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/poll-selcom] Unhandled error:', msg)
    return NextResponse.json({ status: 'error', error: msg }, { status: 500 })
  }
}
