import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { depositRequests } from '@ntzs/db'
import { eq, and, lt, sql } from 'drizzle-orm'

const ZENOPAY_API_URL = process.env.ZENOPAY_API_URL || 'https://api.zeno.africa'
const ZENOPAY_API_KEY = process.env.ZENOPAY_API_KEY || ''
const CRON_SECRET = process.env.CRON_SECRET || ''
const SAFE_MINT_THRESHOLD_TZS = 9000

export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization')
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!ZENOPAY_API_KEY) {
      return NextResponse.json({ status: 'skipped', reason: 'ZENOPAY_API_KEY not configured' })
    }

    const { db } = getDb()

  // Find submitted ZenoPay deposits older than 30 seconds
  const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)
  
  const pendingDeposits = await db
    .select({
      id: depositRequests.id,
      amountTzs: depositRequests.amountTzs,
      createdAt: depositRequests.createdAt,
    })
    .from(depositRequests)
    .where(
      and(
        eq(depositRequests.status, 'submitted'),
        eq(depositRequests.paymentProvider, 'zenopay'),
        lt(depositRequests.createdAt, thirtySecondsAgo)
      )
    )
    .orderBy(depositRequests.createdAt)
    .limit(10)

  const results: Array<{ depositId: string; status: string; transid?: string }> = []

  for (const deposit of pendingDeposits) {
    try {
      const response = await fetch(
        `${ZENOPAY_API_URL}/order-status?order_id=${encodeURIComponent(deposit.id)}`,
        { headers: { 'x-api-key': ZENOPAY_API_KEY } }
      )

      if (!response.ok) {
        results.push({ depositId: deposit.id, status: 'api_error' })
        continue
      }

      const data = await response.json() as {
        result: string
        data?: Array<{
          payment_status: string
          transid: string
          channel: string
        }>
      }

      if (data.result === 'SUCCESS' && data.data?.[0]?.payment_status === 'COMPLETED') {
        const payment = data.data[0]
        
        // Route to Safe approval if amount >= threshold
        const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS 
          ? 'mint_requires_safe' 
          : 'mint_pending'

        await db
          .update(depositRequests)
          .set({
            status: newStatus,
            pspReference: payment.transid,
            pspChannel: payment.channel,
            fiatConfirmedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))

        results.push({ depositId: deposit.id, status: newStatus, transid: payment.transid })
        console.log(`[cron/poll-zenopay] Deposit ${deposit.id} -> ${newStatus}`, { transid: payment.transid })
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
