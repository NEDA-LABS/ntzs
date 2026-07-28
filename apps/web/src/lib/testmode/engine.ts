import { and, desc, eq, lte, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { queuePartnerWebhook } from '@/lib/waas/partner-webhooks'
import { testModeTransactions, testModeUsers } from '@ntzs/db'

import { settleDelayMs } from './mode'
import { testWalletAddress, type TestOutcome } from './scenarios'

/**
 * The test-mode simulator. Every write in this file lands in
 * test_mode_users / test_mode_transactions and nowhere else — see mode.ts for
 * why that structural boundary is the whole safety argument.
 *
 * Settlement has no cron: a pending transaction carries a `settlesAt`, and
 * every test-mode request first sweeps that partner's due rows
 * (`settleDue`). Serverless-safe (nothing depends on a process outliving a
 * response), deterministic, and a partner can force it with
 * POST /api/v1/testmode/advance.
 */

export type TestTxKind = 'deposit' | 'withdrawal' | 'spend' | 'transfer'
export type TestTxStatus = 'pending' | 'completed' | 'failed' | 'reconcile_required'

export interface TestUserRow {
  id: string
  externalId: string
  email: string | null
  name: string | null
  phone: string | null
  walletAddress: string
  balanceTzs: number
  kycStatus: string
}

export interface TestTxRow {
  id: string
  userId: string | null
  kind: string
  status: string
  amountTzs: number
  // jsonb columns arrive as `unknown` from drizzle — callers narrow at use.
  fees: unknown
  detail: unknown
  settlesAt: Date | null
  settledAt: Date | null
  createdAt: Date
}

const USER_COLUMNS = {
  id: testModeUsers.id,
  externalId: testModeUsers.externalId,
  email: testModeUsers.email,
  name: testModeUsers.name,
  phone: testModeUsers.phone,
  walletAddress: testModeUsers.walletAddress,
  balanceTzs: testModeUsers.balanceTzs,
  kycStatus: testModeUsers.kycStatus,
}

const TX_COLUMNS = {
  id: testModeTransactions.id,
  userId: testModeTransactions.userId,
  kind: testModeTransactions.kind,
  status: testModeTransactions.status,
  amountTzs: testModeTransactions.amountTzs,
  fees: testModeTransactions.fees,
  detail: testModeTransactions.detail,
  settlesAt: testModeTransactions.settlesAt,
  settledAt: testModeTransactions.settledAt,
  createdAt: testModeTransactions.createdAt,
}

/** Terminal status a planned outcome resolves to. 'hang' never settles. */
export function statusForOutcome(outcome: TestOutcome): TestTxStatus {
  switch (outcome) {
    case 'fail':
      return 'failed'
    case 'reconcile':
      return 'reconcile_required'
    case 'hang':
      return 'pending'
    default:
      return 'completed'
  }
}

// ── Users ──────────────────────────────────────────────────────────────────

export async function findUserById(partnerId: string, userId: string): Promise<TestUserRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null // a live UUID shape is required before we query
  const { db } = getDb()
  const [row] = await db
    .select(USER_COLUMNS)
    .from(testModeUsers)
    .where(and(eq(testModeUsers.partnerId, partnerId), eq(testModeUsers.id, userId)))
    .limit(1)
  return row ?? null
}

export async function findUserByExternalId(partnerId: string, externalId: string): Promise<TestUserRow | null> {
  const { db } = getDb()
  const [row] = await db
    .select(USER_COLUMNS)
    .from(testModeUsers)
    .where(and(eq(testModeUsers.partnerId, partnerId), eq(testModeUsers.externalId, externalId)))
    .limit(1)
  return row ?? null
}

export async function createUser(args: {
  partnerId: string
  externalId: string
  email: string
  name?: string | null
  phone?: string | null
  kycStatus: 'approved' | 'pending_review'
}): Promise<TestUserRow> {
  const { db } = getDb()
  const [row] = await db
    .insert(testModeUsers)
    .values({
      partnerId: args.partnerId,
      externalId: args.externalId,
      email: args.email,
      name: args.name ?? null,
      phone: args.phone ?? null,
      // A pending_review user has no wallet yet (live contract) — the address
      // is still derived deterministically so it never changes on approval.
      walletAddress: testWalletAddress(args.partnerId, args.externalId),
      balanceTzs: 0,
      kycStatus: args.kycStatus,
    })
    .returning(USER_COLUMNS)
  return row
}

/** Moves a pending_review user to approved (the wallet appears on re-call). */
export async function approveUser(partnerId: string, userId: string): Promise<void> {
  const { db } = getDb()
  await db
    .update(testModeUsers)
    .set({ kycStatus: 'approved', updatedAt: new Date() })
    .where(and(eq(testModeUsers.partnerId, partnerId), eq(testModeUsers.id, userId)))
}

// ── Balances ───────────────────────────────────────────────────────────────

/**
 * Apply a signed delta. Debits are conditional on sufficient balance and
 * return false when they would overdraw — the simulated equivalent of a burn
 * that cannot execute.
 */
export async function applyBalance(userId: string, deltaTzs: number): Promise<boolean> {
  if (deltaTzs === 0) return true
  const { db } = getDb()
  const rows = await db
    .update(testModeUsers)
    .set({ balanceTzs: sql`${testModeUsers.balanceTzs} + ${deltaTzs}`, updatedAt: new Date() })
    .where(
      deltaTzs < 0
        ? and(eq(testModeUsers.id, userId), sql`${testModeUsers.balanceTzs} + ${deltaTzs} >= 0`)
        : eq(testModeUsers.id, userId)
    )
    .returning({ id: testModeUsers.id })
  return rows.length > 0
}

// ── Transactions ───────────────────────────────────────────────────────────

export async function recordTransaction(args: {
  partnerId: string
  userId: string | null
  kind: TestTxKind
  outcome: TestOutcome
  amountTzs: number
  /** Delta applied when the row SETTLES (e.g. deposit credit, payout refund). */
  settlementDeltaTzs?: number
  fees?: Record<string, unknown>
  detail?: Record<string, unknown>
  /** Terminal immediately (transfers) instead of after the settle delay. */
  instant?: boolean
}): Promise<TestTxRow> {
  const { db } = getDb()
  const terminal = statusForOutcome(args.outcome)
  const instant = args.instant === true && terminal !== 'pending'
  const now = Date.now()

  const [row] = await db
    .insert(testModeTransactions)
    .values({
      partnerId: args.partnerId,
      userId: args.userId,
      kind: args.kind,
      status: instant ? terminal : 'pending',
      amountTzs: args.amountTzs,
      balanceDeltaTzs: args.settlementDeltaTzs ?? 0,
      fees: args.fees ?? null,
      detail: { ...(args.detail ?? {}), plannedOutcome: args.outcome },
      // 'hang' never settles: no settlesAt means the sweep never picks it up.
      settlesAt: instant || args.outcome === 'hang' ? null : new Date(now + settleDelayMs()),
      settledAt: instant ? new Date(now) : null,
    })
    .returning(TX_COLUMNS)

  if (instant && args.settlementDeltaTzs && args.userId) {
    await applyBalance(args.userId, args.settlementDeltaTzs)
  }
  return row
}

export async function getTransaction(partnerId: string, id: string): Promise<TestTxRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { db } = getDb()
  const [row] = await db
    .select(TX_COLUMNS)
    .from(testModeTransactions)
    .where(and(eq(testModeTransactions.partnerId, partnerId), eq(testModeTransactions.id, id)))
    .limit(1)
  return row ?? null
}

export async function listTransactions(partnerId: string, limit = 50): Promise<TestTxRow[]> {
  const { db } = getDb()
  return db
    .select(TX_COLUMNS)
    .from(testModeTransactions)
    .where(eq(testModeTransactions.partnerId, partnerId))
    .orderBy(desc(testModeTransactions.createdAt))
    .limit(limit)
}

// ── Settlement sweep ───────────────────────────────────────────────────────

/**
 * Advance every due pending transaction for one partner. Called at the top of
 * every test-mode request, so state moves forward without a cron.
 *
 * Each row is claimed with a conditional UPDATE (status still 'pending')
 * before its balance delta is applied — the same claim-once discipline the
 * live payout engine uses, so a double sweep cannot double-credit.
 */
export async function settleDue(partnerId: string, now: Date = new Date()): Promise<number> {
  const { db } = getDb()

  const due = await db
    .select({
      id: testModeTransactions.id,
      userId: testModeTransactions.userId,
      kind: testModeTransactions.kind,
      amountTzs: testModeTransactions.amountTzs,
      balanceDeltaTzs: testModeTransactions.balanceDeltaTzs,
      detail: testModeTransactions.detail,
      fees: testModeTransactions.fees,
    })
    .from(testModeTransactions)
    .where(
      and(
        eq(testModeTransactions.partnerId, partnerId),
        eq(testModeTransactions.status, 'pending'),
        lte(testModeTransactions.settlesAt, now)
      )
    )
    .limit(200)

  let settled = 0
  for (const row of due) {
    const detail = (row.detail ?? {}) as Record<string, unknown>
    const planned = (detail.plannedOutcome as TestOutcome) ?? 'complete'
    const status = statusForOutcome(planned)
    if (status === 'pending') continue // defensive: 'hang' should have no settlesAt

    const claimed = await db
      .update(testModeTransactions)
      .set({ status, settledAt: now, updatedAt: now })
      .where(and(eq(testModeTransactions.id, row.id), eq(testModeTransactions.status, 'pending')))
      .returning({ id: testModeTransactions.id })
    if (claimed.length === 0) continue // another sweep got it

    if (row.balanceDeltaTzs && row.userId) {
      // Deposits credit only on success; payouts refund only on failure.
      const shouldApply =
        row.kind === 'deposit' ? status === 'completed' : status === 'failed'
      if (shouldApply) await applyBalance(row.userId, row.balanceDeltaTzs)
    }

    await emitTestWebhook(partnerId, row.kind, row.id, status, detail, row.amountTzs)
    settled += 1
  }

  return settled
}

/**
 * Test-mode webhooks mirror the LIVE event surface exactly — `spend.updated`
 * and `kyc.updated` are the only partner events nTZS emits today, so those are
 * the only ones test mode emits. Inventing a `deposit.completed` here would
 * teach partners to depend on an event production never sends.
 *
 * Deliveries are real: signed with the test partner's own webhook secret and
 * retried by the same queue, carrying `livemode: false`.
 */
async function emitTestWebhook(
  partnerId: string,
  kind: string,
  txId: string,
  status: TestTxStatus,
  detail: Record<string, unknown>,
  amountTzs: number
): Promise<void> {
  if (kind !== 'spend') return
  const mapped =
    status === 'completed' ? 'completed' : status === 'failed' ? 'reverted' : 'reconcile_required'
  try {
    await queuePartnerWebhook(partnerId, 'spend.updated', {
      livemode: false,
      spendId: txId,
      externalId: (detail.externalId as string) ?? null,
      reference: (detail.reference as string) ?? null,
      status: mapped,
      kind: (detail.kind as string) ?? null,
      recipientName: (detail.recipientName as string) ?? null,
      principalTzs: amountTzs,
      burnAmountTzs: (detail.burnAmountTzs as number) ?? null,
      actualChargesTzs: (detail.actualChargesTzs as number) ?? null,
      selcomReceipt: (detail.selcomReceipt as string) ?? null,
    })
  } catch (err) {
    console.error('[testmode] webhook queue failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}

export async function queueTestKycWebhook(
  partnerId: string,
  externalId: string,
  kycStatus: string
): Promise<void> {
  try {
    await queuePartnerWebhook(partnerId, 'kyc.updated', {
      livemode: false,
      externalId,
      kycStatus,
      provider: 'testmode',
    })
  } catch (err) {
    console.error('[testmode] kyc webhook queue failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}

// ── Reset ──────────────────────────────────────────────────────────────────

/** Wipe a test partner's world. Cascades transactions via the FK. */
export async function resetPartner(partnerId: string): Promise<{ users: number }> {
  const { db } = getDb()
  await db.delete(testModeTransactions).where(eq(testModeTransactions.partnerId, partnerId))
  const removed = await db
    .delete(testModeUsers)
    .where(eq(testModeUsers.partnerId, partnerId))
    .returning({ id: testModeUsers.id })
  return { users: removed.length }
}
