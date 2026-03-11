import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { depositRequests } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { executeMint } from '@/lib/minting/executeMint'

const CRON_SECRET = process.env.CRON_SECRET || ''

export const maxDuration = 60

/**
 * GET /api/cron/process-mints
 *
 * Fallback/retry for any mint_pending deposits that weren't caught by the
 * instant-mint path in the Snippe webhook. Also retries mint_failed deposits.
 * Runs up to 5 pending jobs per invocation.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const isVercelCron = request.headers.get('x-vercel-cron') === '1'

    if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { db } = getDb()

    const pendingJobs = await db
      .select({ id: depositRequests.id })
      .from(depositRequests)
      .where(and(eq(depositRequests.status, 'mint_pending'), eq(depositRequests.chain, 'base')))
      .orderBy(depositRequests.createdAt)
      .limit(5)

    if (!pendingJobs.length) {
      return NextResponse.json({ status: 'no_pending_jobs' })
    }

    const results = await Promise.all(pendingJobs.map((j) => executeMint(j.id)))

    console.log('[cron/process-mints] results:', results.map((r) => `${r.status}`).join(', '))

    return NextResponse.json({ processed: results.length, results })
  } catch (err) {
    console.error('[cron/process-mints] Unhandled error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
