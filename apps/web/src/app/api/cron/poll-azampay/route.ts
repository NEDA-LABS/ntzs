import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { depositRequests } from '@ntzs/db'
import { eq, and, lt, isNotNull, inArray } from 'drizzle-orm'
import { checkPaymentStatus } from '@/lib/psp/azampay'

const CRON_SECRET = process.env.CRON_SECRET || ''
const SAFE_MINT_THRESHOLD_TZS = 1000000

export const maxDuration = 60

/**
 * GET /api/cron/poll-azampay — Poll AzamPay for completed payments (webhook fallback).
 * Targets deposits with paymentProvider='azampay' whose webhook may have been missed.
 * pspChannel (stored at initiation as the detected MNO provider) is required for
 * the AzamPay status query — if missing, falls back to 'azampesa'.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const isVercelCron = request.headers.get('x-vercel-cron') === '1'

    if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!process.env.AZAMPAY_CLIENT_ID) {
      return NextResponse.json({ status: 'skipped', reason: 'AZAMPAY_CLIENT_ID not configured' })
    }

    const { db } = getDb()

    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)

    const pendingDeposits = await db
      .select({
        id: depositRequests.id,
        amountTzs: depositRequests.amountTzs,
        pspReference: depositRequests.pspReference,
        pspChannel: depositRequests.pspChannel,
        createdAt: depositRequests.createdAt,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.status, 'submitted'),
          inArray(depositRequests.paymentProvider, ['azampay']),
          lt(depositRequests.createdAt, thirtySecondsAgo),
          isNotNull(depositRequests.pspReference),
        )
      )
      .orderBy(depositRequests.createdAt)
      .limit(10)

    const results: Array<{ depositId: string; status: string; reference?: string }> = []

    for (const deposit of pendingDeposits) {
      if (!deposit.pspReference) continue

      try {
        const azamStatus = await checkPaymentStatus(
          deposit.pspReference,
          deposit.pspChannel ?? undefined
        )

        if (azamStatus.status === 'completed') {
          const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS
            ? 'mint_requires_safe'
            : 'mint_pending'

          await db
            .update(depositRequests)
            .set({ status: newStatus, fiatConfirmedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))

          results.push({ depositId: deposit.id, status: newStatus, reference: deposit.pspReference })
          console.log(`[cron/poll-azampay] Deposit ${deposit.id} -> ${newStatus}`)
        } else if (
          azamStatus.status === 'failed' ||
          azamStatus.status === 'expired' ||
          azamStatus.status === 'voided'
        ) {
          await db
            .update(depositRequests)
            .set({ status: 'rejected', updatedAt: new Date() })
            .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))

          results.push({ depositId: deposit.id, status: 'rejected' })
          console.log(`[cron/poll-azampay] Deposit ${deposit.id} -> rejected (${azamStatus.status})`)
        } else {
          results.push({ depositId: deposit.id, status: 'pending' })
        }
      } catch (err) {
        console.error(`[cron/poll-azampay] Error polling ${deposit.id}:`, err instanceof Error ? err.message : err)
        results.push({ depositId: deposit.id, status: 'error' })
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cron/poll-azampay] Unhandled error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
