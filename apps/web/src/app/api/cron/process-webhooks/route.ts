import { NextRequest, NextResponse } from 'next/server'
import { processWebhookQueue } from '@/lib/waas/partner-webhooks'

const CRON_SECRET = process.env.CRON_SECRET || ''

export const maxDuration = 60

/**
 * GET /api/cron/process-webhooks — Deliver pending partner webhook events
 * Called by Vercel cron or manually with CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const isVercelCron = request.headers.get('x-vercel-cron') === '1'

  if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const delivered = await processWebhookQueue()

    return NextResponse.json({
      status: 'ok',
      delivered,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cron/process-webhooks] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
