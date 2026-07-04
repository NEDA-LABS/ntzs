import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { processWebhookQueue } from '@/lib/waas/partner-webhooks'

export const maxDuration = 60

/**
 * GET /api/cron/process-webhooks — Deliver pending partner webhook events
 * Called by Vercel cron or manually with CRON_SECRET
 */
export async function GET(request: NextRequest) {

  if (!isAuthorizedCron(request)) {
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
