import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'

import { getDb } from '@/lib/db'
import { processApprovedBurns } from '@/lib/payouts/burn-engine'

export const maxDuration = 60

/**
 * GET /api/cron/process-burns
 *
 * Executes approved burn_requests (burn nTZS on-chain → mobile-money payout).
 * Replaces the standalone burn worker, which was never deployed — every fiat
 * off-ramp (auto-settlement, financing withdrawals, disbursements) inserted
 * approved requests that nothing executed.
 *
 * GATED: no-ops unless BURN_CRON_ENABLED === 'true'. Ships dark — review any
 * stuck approved requests (Backstage → Treasury) before flipping the switch,
 * because the backlog starts executing immediately when enabled.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (process.env.BURN_CRON_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, disabled: true })
  }

  const { sql: rawSql } = getDb()

  // One executor at a time — burns are 1-2 on-chain txs each.
  const reserved = await rawSql.reserve()
  const [{ locked }] = await reserved<{ locked: boolean }[]>`
    select pg_try_advisory_lock(hashtext('burn_engine')) as locked
  `
  if (!locked) {
    reserved.release()
    return NextResponse.json({ ok: true, skipped: 'another burn run in progress' })
  }

  try {
    const processed = await processApprovedBurns(rawSql, 3)
    return NextResponse.json({ ok: true, processed })
  } catch (err) {
    console.error('[cron/process-burns] unhandled error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  } finally {
    await reserved`select pg_advisory_unlock(hashtext('burn_engine'))`.catch(() => {})
    reserved.release()
  }
}
