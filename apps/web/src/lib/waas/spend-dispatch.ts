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

  // ── Accepted → awaited quick poll (cron is the durable backstop) ────────────
  const delays = [3000, 6000, 12000]
  for (const delay of delays) {
    await new Promise((r) => setTimeout(r, delay))
    try {
      const raw = await queryTransactionRaw(transId)
      if ('error' in raw) continue
      const status = String(raw.body.data?.status ?? '').toUpperCase()
      if (status === 'COMPLETED' || raw.body.result === 'SUCCESS') {
        const d = raw.body.data as Record<string, unknown> | undefined
        const settled = {
          ...spendDescriptor,
          actualChargesTzs: d?.totalCharges != null ? Number(d.totalCharges) : spendDescriptor.actualChargesTzs,
          selcomReceipt: typeof d?.selcomReceipt === 'string' ? d.selcomReceipt : spendDescriptor.selcomReceipt,
        }
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
        const s = await revertForUser('Selcom payment failed (polled)')
        return { reference: transId, payoutStatus: s, settledDescriptor: spendDescriptor, error: 'Selcom payment failed' }
      }
    } catch {
      // next interval
    }
  }

  // Still in flight — the spend-status-sync cron finalizes it.
  return { reference: transId, payoutStatus: 'pending', settledDescriptor: spendDescriptor }
}
