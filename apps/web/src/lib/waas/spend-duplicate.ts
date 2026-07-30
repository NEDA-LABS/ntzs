import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { burnRequests } from '@ntzs/db'

/**
 * Refusing to pay the same bill twice by accident.
 *
 * ⚠ THE INCIDENT THIS EXISTS TO PREVENT. On 30 July 2026 a LUKU payment
 * succeeded at Selcom but the request exceeded its own time limit, so the
 * client never received the response and showed "Payment failed". The customer
 * tapped "Try again" and paid a second time. Two real payments, one meter, one
 * intention.
 *
 * Selcom's own de-duplication could not help: it keys on `transId`, and we
 * generate a fresh one per attempt precisely so that OUR transport retries are
 * idempotent. A user-initiated retry is a different request with a different
 * quote and a different transId — indistinguishable, downstream, from someone
 * deliberately buying twice.
 *
 * So the judgement has to be made here, before the burn, on the shape of the
 * intent: same funding source, same destination, same amount, moments apart.
 *
 * ── Deliberately a 409, not a block ────────────────────────────────────────
 * Buying electricity twice in five minutes is unusual but perfectly legitimate.
 * Refusing it outright would trade one wrong behaviour for another. Instead the
 * caller gets a 409 carrying the ORIGINAL transaction — reference, status and
 * token where we have it — so a client can say "you already paid this, here is
 * your token" and offer to proceed anyway with `allowDuplicate: true`.
 *
 * The default is what protects a customer who taps twice because we showed them
 * a lie; the override is what respects a customer who means it.
 */

/** Long enough to cover a timeout-and-retry, short enough not to govern a second real purchase. */
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000

/**
 * Payout states in which the customer's money is still committed — either paid
 * out or unresolved. A `reverted` spend has been re-minted, so repeating it is
 * not a duplicate but a legitimate second attempt at something that failed.
 */
const MONEY_STILL_COMMITTED = ['pending', 'completed', 'reconcile_required'] as const

export interface DuplicateSpendMatch {
  burnRequestId: string
  reference: string | null
  payoutStatus: string | null
  createdAt: Date
  /** The original's disclosure/settlement snapshot — carries the token if we have it. */
  spend: Record<string, unknown> | null
}

/**
 * The most recent spend from this source, to this destination, for this amount,
 * inside the window and still holding the customer's money.
 *
 * Matching on the burn address rather than the user id is deliberate: it is the
 * actual source of funds, and it covers agent-float sub-wallets without a
 * second code path.
 */
export async function findDuplicateSpend(args: {
  burnFromAddress: string
  target: string
  burnAmountTzs: number
  windowMs?: number
  now?: Date
}): Promise<DuplicateSpendMatch | null> {
  const { db } = getDb()
  const now = args.now ?? new Date()
  const since = new Date(now.getTime() - (args.windowMs ?? DUPLICATE_WINDOW_MS))

  const rows = await db
    .select({
      id: burnRequests.id,
      reference: burnRequests.payoutReference,
      payoutStatus: burnRequests.payoutStatus,
      createdAt: burnRequests.createdAt,
      spend: burnRequests.spend,
    })
    .from(burnRequests)
    .where(
      and(
        eq(burnRequests.burnFromAddress, args.burnFromAddress),
        eq(burnRequests.amountTzs, args.burnAmountTzs),
        gte(burnRequests.createdAt, since),
        inArray(burnRequests.payoutStatus, [...MONEY_STILL_COMMITTED]),
        // The destination lives in the descriptor; compare the canonical target
        // string so lipa and bill are handled by one predicate.
        sql`(
          case
            when ${burnRequests.spend}->>'kind' = 'lipa'
              then 'lipa:' || coalesce(${burnRequests.spend}->>'payNumber', '')
            when ${burnRequests.spend}->>'kind' = 'bill'
              then 'bill:' || coalesce(${burnRequests.spend}->>'utilityCode', '') || ':' || coalesce(${burnRequests.spend}->>'utilityRef', '')
            else ''
          end
        ) = ${args.target}`
      )
    )
    .orderBy(desc(burnRequests.createdAt))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    burnRequestId: row.id,
    reference: row.reference ?? null,
    payoutStatus: row.payoutStatus ?? null,
    createdAt: row.createdAt,
    spend: (row.spend as Record<string, unknown> | null) ?? null,
  }
}

/**
 * The 409 body. Carries enough for a client to resolve the situation without a
 * support ticket: what was already paid, its state, and the voucher if we have
 * it — plus how to proceed deliberately.
 */
export function duplicateSpendResponse(match: DuplicateSpendMatch, windowMs = DUPLICATE_WINDOW_MS) {
  const spend = match.spend ?? {}
  return {
    error: 'duplicate_spend',
    message:
      `An identical payment from this wallet to the same destination for the same amount was made ` +
      `${Math.round((Date.now() - match.createdAt.getTime()) / 1000)}s ago and is ${match.payoutStatus ?? 'in progress'}. ` +
      `Show the customer the existing transaction. To pay again deliberately, retry with "allowDuplicate": true.`,
    existing: {
      spendId: match.burnRequestId,
      reference: match.reference,
      payoutStatus: match.payoutStatus,
      createdAt: match.createdAt.toISOString(),
      ...(typeof spend.utilityToken === 'string' ? { utilityToken: spend.utilityToken } : {}),
      ...(typeof spend.utilityUnits === 'string' ? { utilityUnits: spend.utilityUnits } : {}),
      ...(typeof spend.selcomReceipt === 'string' ? { selcomReceipt: spend.selcomReceipt } : {}),
    },
    windowSeconds: Math.round(windowMs / 1000),
  }
}
