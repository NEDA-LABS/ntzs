import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { burnRequests } from '@ntzs/db'

export const CIRCUIT_WINDOW_MS = 15 * 60 * 1000
export const CIRCUIT_FAIL_THRESHOLD = 3

/**
 * Pure decision, unit-tested: the rails look dead when initiation refusals
 * have piled up in the window and NOTHING succeeded in the same window. One
 * success is proof of life — a mixed picture must not block a working rail.
 */
export function circuitDecision(recentInitiationRefusals: number, recentInitiationSuccesses: number): boolean {
  return recentInitiationRefusals >= CIRCUIT_FAIL_THRESHOLD && recentInitiationSuccesses === 0
}

/**
 * True when the payout rails look dead — callers must REFUSE BEFORE BURNING.
 *
 * ⚠ WHY THIS EXISTS. On 1 Aug 2026 every disbursement rail refused
 * initiations for ~4 hours (Snippe account flag + a wrong Selcom FI-code
 * table). Burn-first is correct when the payout can be dispatched — but that
 * day, a partner integration and retrying users kept burning against rails
 * that could not pay: six burns, 899,034 TZS stranded in reconcile, wallets
 * drained with nothing received. The honest failure once the rails are
 * evidently down is a 503 BEFORE money moves: balance untouched, retry later.
 *
 * Evidence-based: recent burn rows whose payout initiation was refused
 * outright (reconcile_required with no reference) versus rows whose
 * initiation was accepted. FAIL-OPEN on any query error — a broken breaker
 * must never block a healthy rail. Operator tooling (redispatch, manual
 * reconcile) is deliberately not gated.
 */
export async function payoutRailsLookDead(): Promise<{ dead: boolean; reason?: string }> {
  try {
    const { db } = getDb()
    const since = new Date(Date.now() - CIRCUIT_WINDOW_MS)
    const [refused] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(burnRequests)
      .where(and(
        gte(burnRequests.createdAt, since),
        eq(burnRequests.payoutStatus, 'reconcile_required'),
        isNull(burnRequests.payoutReference),
      ))
    const [accepted] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(burnRequests)
      .where(and(
        gte(burnRequests.createdAt, since),
        inArray(burnRequests.payoutStatus, ['pending', 'completed']),
      ))
    const refusals = refused?.n ?? 0
    const successes = accepted?.n ?? 0
    if (circuitDecision(refusals, successes)) {
      return { dead: true, reason: `${refusals} payout initiation refusal(s) and no accepted dispatch in the last 15 minutes` }
    }
    return { dead: false }
  } catch (e) {
    console.error('[payout-circuit] check failed — failing OPEN:', e instanceof Error ? e.message : e)
    return { dead: false }
  }
}

/** Shared 503 body for every gated cash-out path. */
export const CIRCUIT_OPEN_RESPONSE = {
  error: 'cashout_temporarily_unavailable',
  message:
    'Cash-outs are temporarily unavailable — our payout providers are not accepting disbursements right now. Your balance is untouched. Please try again shortly.',
} as const
