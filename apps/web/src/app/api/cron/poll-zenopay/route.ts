/**
 * GET /api/cron/poll-zenopay
 *
 * LEGACY — polls ZenoPay for any deposits that were initiated before the
 * migration to Snippe and are still stuck in 'submitted' status.
 *
 * This cron should become a no-op naturally once all historic ZenoPay
 * deposits have reached a terminal status. It is safe to keep running.
 *
 * Skips gracefully if ZENOPAY_API_KEY is not configured.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getDb } from '@/lib/db'
import { depositRequests } from '@ntzs/db'
import { eq, and, lt, isNotNull } from 'drizzle-orm'
import { getZenoPayOrderStatus } from '@/lib/psp/zenopay'

const SAFE_MINT_THRESHOLD_TZS = 100000

export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {

    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!process.env.ZENOPAY_API_KEY) {
      return NextResponse.json({ status: 'skipped', reason: 'ZENOPAY_API_KEY not configured — ZenoPay is legacy' })
    }

    const { db } = getDb()

    // Find submitted ZenoPay deposits older than 30 seconds that have a psp_reference (order_id)
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)

    const pendingDeposits = await db
      .select({
        id: depositRequests.id,
        amountTzs: depositRequests.amountTzs,
        pspReference: depositRequests.pspReference,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.status, 'submitted'),
          eq(depositRequests.paymentProvider, 'zenopay'),
          isNotNull(depositRequests.pspReference),
          lt(depositRequests.createdAt, thirtySecondsAgo)
        )
      )
      .orderBy(depositRequests.createdAt)
      .limit(10)

    const results: Array<{ depositId: string; status: string; reference?: string }> = []

    for (const deposit of pendingDeposits) {
      if (!deposit.pspReference) continue

      try {
        const zenoStatus = await getZenoPayOrderStatus(deposit.pspReference)
        const orderData = zenoStatus.data?.[0]

        if (orderData?.payment_status === 'COMPLETED') {
          const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS
            ? 'mint_requires_safe'
            : 'mint_pending'

          await db
            .update(depositRequests)
            .set({
              status: newStatus,
              pspChannel: orderData.channel || null,
              fiatConfirmedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))

          results.push({ depositId: deposit.id, status: newStatus, reference: deposit.pspReference })
          console.log(`[cron/poll-zenopay] Deposit ${deposit.id} -> ${newStatus}`)
        } else if (orderData?.payment_status === 'FAILED') {
          await db
            .update(depositRequests)
            .set({ status: 'rejected', updatedAt: new Date() })
            .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))

          results.push({ depositId: deposit.id, status: 'rejected' })
          console.log(`[cron/poll-zenopay] Deposit ${deposit.id} -> rejected`)
        } else {
          results.push({ depositId: deposit.id, status: 'pending' })
        }
      } catch (err) {
        console.error(`[cron/poll-zenopay] Error polling ${deposit.id}:`, err instanceof Error ? err.message : err)
        results.push({ depositId: deposit.id, status: 'error' })
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cron/poll-zenopay] Unhandled error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
