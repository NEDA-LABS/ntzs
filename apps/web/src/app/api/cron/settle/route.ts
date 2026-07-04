import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'

import { getDb } from '@/lib/db'
import { runLenderSettlement } from '@/lib/settlement'
import { fireBatchSettlements, syncMerchantSettlementStatus } from '@/lib/payouts/settlement-payouts'

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
  if (!isAuthorizedCron(request)) {
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

    // Merchant payout phases (pot → burn request → status sync) ride the same
    // lock; /api/cron/process-burns executes the resulting burn requests.
    let payoutBatches = 0
    let payoutsSynced = 0
    try { payoutBatches = await fireBatchSettlements(rawSql) }
    catch (err) { result.errors.push(`payout-batch: ${err instanceof Error ? err.message : String(err)}`) }
    try { payoutsSynced = await syncMerchantSettlementStatus(rawSql) }
    catch (err) { result.errors.push(`payout-sync: ${err instanceof Error ? err.message : String(err)}`) }

    return NextResponse.json({ ok: true, ...result, payoutBatches, payoutsSynced })
  } finally {
    await reserved`select pg_advisory_unlock(hashtext('lender_settlement'))`.catch(() => {})
    reserved.release()
  }
}
