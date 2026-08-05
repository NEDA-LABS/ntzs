import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getDb } from '@/lib/db'
import { depositRequests } from '@ntzs/db'
import { eq, and, lt, inArray, isNotNull, desc } from 'drizzle-orm'
// The SNIPPE adapter directly, NOT the '@/lib/psp' router: that router picks
// an implementation from the global ACTIVE_PSP_PROVIDER switch, so with
// AzamPay active it would have queried AzamPay with a Snippe reference.
import { checkPaymentStatus } from '@/lib/psp/snippe'
import { SAFE_MINT_THRESHOLD_TZS } from '@/lib/approvals/thresholds'


export const maxDuration = 60

/**
 * GET /api/cron/poll-snippe — Poll Snippe for completed payments.
 *
 * NOT merely a webhook fallback — it is the only settlement path when a
 * webhook is missed or arrives for a row we had already closed. It covers
 * BOTH Snippe providers: 'snippe' (mobile money) and 'snippe_card'.
 *
 * ⚠ It used to poll 'snippe_card' ONLY, which left Snippe MOBILE deposits with
 * no fallback whatsoever — a missed webhook meant the money simply never
 * credited, silently. That is exactly how a customer's 105,000 TZS collection
 * went unminted for ~15 hours on 4 Aug 2026.
 */
export async function GET(request: NextRequest) {
  try {

    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!process.env.SNIPPE_API_KEY) {
      return NextResponse.json({ status: 'skipped', reason: 'SNIPPE_API_KEY not configured' })
    }

    const { db } = getDb()

    // Find submitted Snippe deposits older than 30 seconds that have a psp_reference
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)

    const pendingDeposits = await db
      .select({
        id: depositRequests.id,
        amountTzs: depositRequests.amountTzs,
        pspReference: depositRequests.pspReference,
        buyerPhone: depositRequests.buyerPhone,
        createdAt: depositRequests.createdAt,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.status, 'submitted'),
          inArray(depositRequests.paymentProvider, ['snippe', 'snippe_card']),
          lt(depositRequests.createdAt, thirtySecondsAgo),
          // A row with no reference cannot be polled — it is resolved by the
          // webhook or by a human. Excluding it here matters because an
          // uncertain initiation now leaves exactly that shape behind, and
          // such rows would otherwise sit in every page of this query forever.
          isNotNull(depositRequests.pspReference)
        )
      )
      // Newest first — the AzamPay poll-starvation lesson: a stuck backlog
      // must never occupy every slot and starve fresh deposits.
      .orderBy(desc(depositRequests.createdAt))
      .limit(25)

    const results: Array<{ depositId: string; status: string; reference?: string }> = []

    for (const deposit of pendingDeposits) {
      if (!deposit.pspReference) continue

      try {
        const snippeStatus = await checkPaymentStatus(deposit.pspReference)

        if (snippeStatus.status === 'completed') {
          const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS
            ? 'mint_requires_safe'
            : 'mint_pending'

          await db
            .update(depositRequests)
            .set({
              status: newStatus,
              fiatConfirmedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))

          results.push({ depositId: deposit.id, status: newStatus, reference: deposit.pspReference })
          console.log(`[cron/poll-snippe] Deposit ${deposit.id} -> ${newStatus}`)
        } else if (snippeStatus.status === 'failed' || snippeStatus.status === 'expired' || snippeStatus.status === 'voided') {
          await db
            .update(depositRequests)
            .set({
              status: 'rejected',
              updatedAt: new Date(),
            })
            .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))

          results.push({ depositId: deposit.id, status: 'rejected' })
          console.log(`[cron/poll-snippe] Deposit ${deposit.id} -> rejected (${snippeStatus.status})`)
        } else {
          results.push({ depositId: deposit.id, status: 'pending' })
        }
      } catch (err) {
        console.error(`[cron/poll-snippe] Error polling ${deposit.id}:`, err instanceof Error ? err.message : err)
        results.push({ depositId: deposit.id, status: 'error' })
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cron/poll-snippe] Unhandled error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
