import { eq, and, or } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { burnRequests } from '@ntzs/db'
import {
  payLipa,
  payBill,
  makeNumericTransId,
  queryTransactionRaw,
  checkPayoutStatus,
} from '@/lib/psp/selcom'
import { mergeSettlement, readSelcomSettlement, selcomFailureReason } from '@/lib/psp/selcom-settlement'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'
import { emitSpendWebhook } from '@/lib/waas/spend-webhook'
import type { SpendKind } from '@/lib/waas/spend-quote'

/**
 * THE single money-moving path for a Selcom spend (Lipa till / biller), shared
 * by the domestic spend product (POST /api/v1/spend) and the ramp off-ramp
 * (USDC → Lipa/bill). The burn has ALREADY happened on the caller's row; this
 * takes the burn_requests row from "burned, no payout" to a terminal payout
 * state and keeps the revert discipline in one place:
 *
 *  - transId generated ONCE and persisted BEFORE dispatch → crash-safe
 *    reference + idempotent at Selcom (retries inside payLipa/payBill reuse it)
 *  - dispatch → success: awaited quick poll (≈4s live settle); the
 *    spend-status-sync cron is the durable backstop
 *  - decisive Selcom FAILED (dispatch reject or polled fail) → claim-once
 *    revert (revertOffRampBurn re-mints; fee handling per the passed split)
 *  - ambiguous transport outcome → reconcile_required (never auto-reverted)
 *  - spend.updated partner webhook fires on every terminal state (no-ops when
 *    the descriptor carries no partnerId, e.g. ramp rows use ramp.settlement.*)
 */

export interface SpendDispatchArgs {
  burnRequestId: string
  kind: SpendKind
  principalTzs: number
  payNumber?: string
  network?: string
  utilityCode?: string
  utilityRef?: string
  /** Disclosure snapshot already stored on the burn row's `spend` column. */
  spendDescriptor: Record<string, unknown>
  /** burnAmountTzs on the row — carried into the webhook payload. */
  burnAmountTzs: number
  /** Revert parameters — superset covering domestic spend (platform fee only)
   * and ramp (platform + NEDA split); passed straight to revertOffRampBurn. */
  revert: Omit<Parameters<typeof revertOffRampBurn>[0], 'burnRequestId' | 'reason'>
  /** Log prefix, e.g. 'v1/spend' or 'ramp/offramp'. */
  label?: string
  /**
   * Absolute epoch-ms deadline for the awaited settle poll.
   *
   * ⚠ WHY A DEADLINE AND NOT A FIXED LADDER. This poll used to sleep a flat
   * 3+6+12 = 21 seconds. On a route capped at 60s, after an on-chain burn and
   * up to two fee mints, that was enough to push the whole request past its
   * limit — the platform killed the function AFTER Selcom had been paid, the
   * client saw a network failure, and the customer retried and paid twice
   * (30 July 2026).
   *
   * The poll is worth keeping: when settlement is quick the caller gets a
   * synchronous `completed` and, for a utility purchase, the token in the same
   * response. But it must never plan to overrun the caller's own budget. Pass a
   * deadline computed from when the REQUEST started, not from here — by this
   * point the burn has already spent an unknown slice of it.
   *
   * Omit to poll the full ladder (callers with a generous limit, e.g. ramp).
   */
  pollDeadlineMs?: number
}

export interface SpendDispatchResult {
  reference: string
  payoutStatus: 'completed' | 'pending' | 'reverted' | 'reconcile_required'
  settledDescriptor: Record<string, unknown>
  error?: string
}

export async function dispatchSpendPayment(args: SpendDispatchArgs): Promise<SpendDispatchResult> {
  const { db } = getDb()
  const { burnRequestId, kind, principalTzs, spendDescriptor, burnAmountTzs } = args
  const tag = `[${args.label ?? 'spend-dispatch'}]`

  const transId = makeNumericTransId()
  await db
    .update(burnRequests)
    .set({ payoutReference: transId, payoutStatus: 'pending', updatedAt: new Date() })
    .where(eq(burnRequests.id, burnRequestId))

  const claimRevert = async (): Promise<boolean> => {
    const updated = await db
      .update(burnRequests)
      .set({ payoutStatus: 'reverting', updatedAt: new Date() })
      .where(
        and(
          eq(burnRequests.id, burnRequestId),
          or(eq(burnRequests.payoutStatus, 'pending'), eq(burnRequests.payoutStatus, 'failed'))
        )
      )
      .returning({ id: burnRequests.id })
    return updated.length > 0
  }

  const revertForUser = async (reason: string): Promise<'reverted' | 'reconcile_required'> => {
    if (!(await claimRevert())) {
      // Someone else finalized concurrently — report the row's current state.
      const [row] = await db
        .select({ payoutStatus: burnRequests.payoutStatus })
        .from(burnRequests)
        .where(eq(burnRequests.id, burnRequestId))
        .limit(1)
      return row?.payoutStatus === 'reverted' ? 'reverted' : 'reconcile_required'
    }
    const res = await revertOffRampBurn({ burnRequestId, reason, ...args.revert })
    const status = res.error ? 'reconcile_required' : 'reverted'
    await db
      .update(burnRequests)
      .set({
        status: 'failed',
        payoutStatus: status,
        payoutError: res.error ? `${reason} | remint_error: ${res.error}` : reason,
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))
    console.log(`${tag} burn reverted`, { burnRequestId, reason, remintError: res.error })
    await emitSpendWebhook(spendDescriptor, { burnRequestId, reference: transId, status, burnAmountTzs })
    return status
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────
  let outcome: 'accepted' | 'failed_clean' | 'ambiguous' = 'ambiguous'
  let dispatchError: string | undefined
  try {
    const dispatch =
      kind === 'lipa'
        ? await payLipa({ payNumber: args.payNumber as string, network: args.network, amountTzs: principalTzs, transId })
        : await payBill({ utilityCode: args.utilityCode as string, utilityRef: args.utilityRef as string, amountTzs: principalTzs, transId })
    if (dispatch.success) {
      outcome = 'accepted'
    } else {
      dispatchError = dispatch.error
      const st = await checkPayoutStatus(transId)
      outcome = st.status === 'failed' ? 'failed_clean' : 'ambiguous'
    }
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : String(err)
    outcome = 'ambiguous'
  }

  if (outcome === 'failed_clean') {
    const status = await revertForUser(dispatchError || 'Selcom rejected the payment')
    return { reference: transId, payoutStatus: status, settledDescriptor: spendDescriptor, error: dispatchError }
  }

  if (outcome === 'ambiguous') {
    await db
      .update(burnRequests)
      .set({ payoutStatus: 'reconcile_required', payoutError: dispatchError ?? 'Selcom did not confirm', updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    await emitSpendWebhook(spendDescriptor, { burnRequestId, reference: transId, status: 'reconcile_required', burnAmountTzs })
    return { reference: transId, payoutStatus: 'reconcile_required', settledDescriptor: spendDescriptor, error: dispatchError }
  }

  // ── Accepted → awaited quick poll, bounded by the caller's budget ──────────
  // The cron is the durable backstop, so giving up early costs nothing but a
  // synchronous answer; overrunning costs a double charge.
  const delays = [3000, 6000, 12000]
  const deadline = args.pollDeadlineMs
  for (const delay of delays) {
    if (deadline != null && Date.now() + delay > deadline) {
      console.log(`${tag} ${transId} poll budget exhausted — leaving it to the cron`)
      break
    }
    await new Promise((r) => setTimeout(r, delay))
    try {
      const raw = await queryTransactionRaw(transId)
      if ('error' in raw) continue
      const status = String(raw.body.data?.status ?? '').toUpperCase()
      if (status === 'COMPLETED' || raw.body.result === 'SUCCESS') {
        // One reader for the payload, tolerant of naming, and it keeps the raw
        // answer — the previous code read camelCase keys off a snake_case body,
        // so charges and receipts were silently never recorded.
        const settled = mergeSettlement(spendDescriptor, readSelcomSettlement(raw.body.data))
        const done = await db
          .update(burnRequests)
          .set({ status: 'burned', payoutStatus: 'completed', spend: settled, updatedAt: new Date() })
          .where(and(eq(burnRequests.id, burnRequestId), eq(burnRequests.payoutStatus, 'pending')))
          .returning({ id: burnRequests.id })
        if (done.length > 0) {
          console.log(`${tag} ${transId} completed (polled)`)
          await emitSpendWebhook(settled, { burnRequestId, reference: transId, status: 'completed', burnAmountTzs })
        }
        return { reference: transId, payoutStatus: 'completed', settledDescriptor: settled }
      }
      if (status === 'FAILED' || raw.body.result === 'FAIL') {
        // Selcom's verdict belongs ON THE ROW. 30 Jul: a reverted lipa spend
        // carried only "polled", and finding out WHY took an admin probe —
        // failure evidence deserves the same capture as success evidence.
        const why = selcomFailureReason(raw.body)
        const failed = mergeSettlement(spendDescriptor, readSelcomSettlement(raw.body.data))
        await db
          .update(burnRequests)
          .set({ spend: failed, updatedAt: new Date() })
          .where(eq(burnRequests.id, burnRequestId))
        const s = await revertForUser(why ? `Selcom FAILED: ${why}` : 'Selcom FAILED (no reason given in status query)')
        return { reference: transId, payoutStatus: s, settledDescriptor: failed, error: why || 'Selcom payment failed' }
      }
    } catch {
      // next interval
    }
  }

  // Still in flight — the spend-status-sync cron finalizes it.
  return { reference: transId, payoutStatus: 'pending', settledDescriptor: spendDescriptor }
}
