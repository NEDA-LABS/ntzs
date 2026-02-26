import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { depositRequests } from '@ntzs/db'
import { eq, and, lt, isNotNull } from 'drizzle-orm'
import { checkPaymentStatus } from '@/lib/psp/snippe'

const CRON_SECRET = process.env.CRON_SECRET || ''
const SAFE_MINT_THRESHOLD_TZS = 9000

export const maxDuration = 60

/**
 * GET /api/cron/poll-snippe — Poll Snippe for completed payments (webhook fallback)
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const isVercelCron = request.headers.get('x-vercel-cron') === '1'

    if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
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
        createdAt: depositRequests.createdAt,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.status, 'submitted'),
          eq(depositRequests.paymentProvider, 'snippe'),
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
