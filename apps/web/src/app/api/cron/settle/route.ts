import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { runLenderSettlement } from '@/lib/settlement'

const CRON_SECRET = process.env.CRON_SECRET || ''

export const maxDuration = 60

/**
 * GET /api/cron/settle
 *
 * Runs the lender settlement cycle (queue collection splits → fire on-chain
 * lender repayments → auto-close repaid loans). Scheduled in vercel.json.
 *
 * Replaces the standalone settlement worker for the lender pipeline, which was
 * never deployed — so collections piled up `settlement_status = pending` and
 * lenders were never repaid.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const isVercelCron = request.headers.get('x-vercel-cron') === '1'
  if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { sql: rawSql } = getDb()

  // Serialize runs: only one settlement cycle at a time, so overlapping cron
  // invocations can't double-process. Session advisory lock on a reserved
  // connection (lock + unlock share the same pooled connection).
  const reserved = await rawSql.reserve()
  const [{ locked }] = await reserved<{ locked: boolean }[]>`
    select pg_try_advisory_lock(hashtext('lender_settlement')) as locked
  `
  if (!locked) {
    reserved.release()
    return NextResponse.json({ ok: true, skipped: 'another settlement run in progress' })
  }

  try {
    const result = await runLenderSettlement(rawSql)
    return NextResponse.json({ ok: true, ...result })
  } finally {
    await reserved`select pg_advisory_unlock(hashtext('lender_settlement'))`.catch(() => {})
    reserved.release()
  }
}
