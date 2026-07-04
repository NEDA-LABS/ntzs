import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { eq, and } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { rampSettlements, depositRequests } from '@ntzs/db'
import { runOnrampSwapLeg } from '@/lib/ramp/onramp'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * GET /api/cron/ramp-settle
 *
 * Drives the post-mint leg of on-ramp settlements: once a ramp deposit has
 * minted nTZS to the partner's settlement wallet, swap it to USDC and deliver.
 * Advisory-locked so overlapping invocations can't double-process.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { db, sql: rawSql } = getDb()

  const reserved = await rawSql.reserve()
  const [{ locked }] = await reserved<{ locked: boolean }[]>`
    select pg_try_advisory_lock(hashtext('ramp_settlement')) as locked
  `
  if (!locked) {
    reserved.release()
    return NextResponse.json({ ok: true, skipped: 'another ramp-settle run in progress' })
  }

  try {
    // On-ramp settlements whose deposit has minted but USDC leg hasn't run yet.
    const due = await db
      .select({ settlementId: rampSettlements.id })
      .from(rampSettlements)
      .innerJoin(depositRequests, eq(depositRequests.rampSettlementId, rampSettlements.id))
      .where(and(
        eq(rampSettlements.direction, 'onramp'),
        eq(rampSettlements.status, 'minting'),
        eq(depositRequests.status, 'minted'),
      ))
      .limit(10)

    let completed = 0
    const errors: string[] = []
    for (const { settlementId } of due) {
      try {
        const r = await runOnrampSwapLeg(settlementId)
        if (r.ok) completed += 1
        else if (r.status === 'failed') errors.push(`${settlementId}: ${r.error}`)
        // status still 'minting' (nTZS not minted yet) → leave for next run
      } catch (err) {
        errors.push(`${settlementId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return NextResponse.json({ ok: true, due: due.length, completed, errors })
  } finally {
    await reserved`select pg_advisory_unlock(hashtext('ramp_settlement'))`.catch(() => {})
    reserved.release()
  }
}
