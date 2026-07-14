/**
 * Disbursement kill switch (guard G3).
 *
 * A single check that every payout-initiating path calls BEFORE burning nTZS or
 * calling the PSP. Two independent sources can pause disbursements:
 *
 *   1. env `DISBURSEMENTS_PAUSED=1` — a hard override baked into the deploy,
 *      usable even if the DB is unreachable.
 *   2. `system_flags` row `disbursements_paused` = true — an instant toggle ops
 *      can flip from a script / backstage with no redeploy.
 *
 * Fail direction: a deliberate pause (either source) blocks payouts. A transient
 * failure to READ the flag does NOT block — every payout path needs the DB for
 * the burn record anyway, so a flag-read blip must not, by itself, halt all
 * withdrawals. Deliberate halts always go through one of the two sources above.
 */
import { getDb } from '@/lib/db'

export const DISBURSEMENTS_PAUSED_FLAG = 'disbursements_paused'

export class DisbursementsPausedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'DisbursementsPausedError'
  }
}

/** Returns a human-readable reason when payouts are halted, else `null`. */
export async function disbursementsPausedReason(): Promise<string | null> {
  if (process.env.DISBURSEMENTS_PAUSED === '1') {
    return 'Withdrawals are temporarily paused for maintenance. Please try again shortly.'
  }
  try {
    const { sql } = getDb()
    const rows = await sql<{ enabled: boolean; note: string | null }[]>`
      select enabled, note from system_flags where key = ${DISBURSEMENTS_PAUSED_FLAG} limit 1
    `
    if (rows[0]?.enabled) {
      return rows[0].note?.trim() || 'Withdrawals are temporarily paused. Please try again shortly.'
    }
  } catch (err) {
    console.error('[disbursements] flag read failed (treating as not paused):', err instanceof Error ? err.message : err)
  }
  return null
}

/** Throws {@link DisbursementsPausedError} when payouts are halted. */
export async function assertDisbursementsEnabled(): Promise<void> {
  const reason = await disbursementsPausedReason()
  if (reason) throw new DisbursementsPausedError(reason)
}
