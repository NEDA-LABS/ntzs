import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { checkPayoutStatus, checkPayoutStatusFor, sendPayoutRouted, normalizePhone } from '@/lib/psp'
import { PSP_FLAT_FEE_TZS } from '@/lib/waas/quote'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'
import { writeAuditLog } from '@/lib/audit'
import { burnRequests, wallets } from '@ntzs/db'

// redispatch awaits a short settlement poll after dispatching.
export const maxDuration = 60

const APP_URL = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''

// Explicit column set (both fetch sites) — keeps this route immune to schema
// columns that exist in code before their migration is applied.
const RECONCILE_BURN_COLUMNS = {
  id: burnRequests.id,
  status: burnRequests.status,
  payoutStatus: burnRequests.payoutStatus,
  payoutError: burnRequests.payoutError,
  payoutReference: burnRequests.payoutReference,
  recipientPhone: burnRequests.recipientPhone,
  txHash: burnRequests.txHash,
  amountTzs: burnRequests.amountTzs,
  platformFeeTzs: burnRequests.platformFeeTzs,
  feeTxHash: burnRequests.feeTxHash,
  feeRecipientAddress: burnRequests.feeRecipientAddress,
  nedaFeeTzs: burnRequests.nedaFeeTzs,
  nedaFeeTxHash: burnRequests.nedaFeeTxHash,
  walletId: burnRequests.walletId,
  userId: burnRequests.userId,
  createdAt: burnRequests.createdAt,
  updatedAt: burnRequests.updatedAt,
} as const

/**
 * POST /api/admin/burns/:id/reconcile
 *
 * Operator-only endpoint to resolve a burn stuck in `payout_status =
 * reconcile_required`. Queries Snippe for the authoritative state first;
 * refuses to move funds on ambiguous / pending states unless the operator
 * explicitly forces an action.
 *
 * Body: {
 *   action?: 'auto' | 'force_revert' | 'mark_completed'
 *   snippeReference?: string   // optional: supply if our row is missing
 *                              // one (e.g. historical bug where Snippe
 *                              // returned an error body but created a
 *                              // payout record server-side anyway).
 *   notes?: string
 * }
 *
 * - `auto` (default): trust only Snippe's confirmed states:
 *      completed → mark local row completed
 *      failed/reversed → revertOffRampBurn
 *      pending → refuse, return 409 so operator checks dashboard
 *      no reference (and none supplied in body) → refuse, return 409
 * - `force_revert`: operator has personally confirmed in Snippe dashboard
 *   that the payout will not be dispatched. Performs the revert.
 * - `mark_completed`: operator has personally confirmed the payout did
 *   actually reach the user (manual payout / reconciled externally). Marks
 *   the row completed without any on-chain action.
 * - `redispatch`: pay the ORIGINAL withdrawal's payout leg through the (now
 *   working) failover dispatcher — no new burn, no user retry. Born on
 *   1 Aug 2026: every rail refused initiations, users' burns piled up in
 *   reconcile_required, and once the rail was fixed the humane resolution
 *   for the row a user actually wanted was to complete it, not to revert
 *   and make them attempt a sixth time. Refused when the row carries a
 *   payout reference (a dispatch may exist — resolve via auto first) or
 *   when the burn didn't complete.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const dbUser = await requireAnyRole(['super_admin', 'platform_compliance'])
  const { id: burnRequestId } = await params

  let body: {
    action?: 'auto' | 'force_revert' | 'mark_completed' | 'redispatch'
    snippeReference?: string
    notes?: string
  } = {}
  try {
    body = await request.json()
  } catch {
    // Empty body = auto
  }
  const action = body.action ?? 'auto'

  const { db } = getDb()

  const [burn] = await db
    .select(RECONCILE_BURN_COLUMNS)
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (!burn) {
    return NextResponse.json({ error: 'Burn request not found' }, { status: 404 })
  }

  if (burn.payoutStatus !== 'reconcile_required' && action === 'auto') {
    return NextResponse.json(
      {
        error: 'Burn is not in reconcile_required state',
        currentStatus: burn.status,
        currentPayoutStatus: burn.payoutStatus,
        hint: 'Use an explicit action (force_revert / mark_completed) if you really mean to override.',
      },
      { status: 409 }
    )
  }

  const [userWallet] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(eq(wallets.id, burn.walletId))
    .limit(1)

  if (!userWallet) {
    return NextResponse.json(
      { error: 'Wallet record missing for this burn — cannot reconcile safely' },
      { status: 500 }
    )
  }

  // ── force_revert ──────────────────────────────────────────────────────────
  if (action === 'force_revert') {
    const revert = await revertOffRampBurn({
      burnRequestId,
      userAddress: userWallet.address,
      burnAmountTzs: burn.amountTzs,
      platformFeeTzs: burn.platformFeeTzs,
      feeRecipientAddress: burn.feeRecipientAddress,
      feeMintOccurred: Boolean(burn.feeTxHash),
      nedaFeeTzs: burn.nedaFeeTzs,
      nedaFeeMintOccurred: Boolean(burn.nedaFeeTxHash),
      reason: `operator_force_revert: ${body.notes ?? 'no_notes'}`,
    })

    await db
      .update(burnRequests)
      .set({
        status: 'failed',
        payoutStatus: revert.error ? 'reconcile_required' : 'reverted',
        payoutError: revert.error
          ? `${burn.payoutError ?? ''} | operator_force_revert_failed: ${revert.error}`
          : `${burn.payoutError ?? ''} | operator_force_reverted`,
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))

    await writeAuditLog(
      'burn.operator_force_reverted',
      'burn_request',
      burnRequestId,
      {
        operatorId: dbUser.id,
        notes: body.notes,
        remintTxHash: revert.remintTxHash,
        feeBurnTxHash: revert.feeBurnTxHash,
        remintError: revert.error,
      },
      dbUser.id,
    )

    if (revert.error) {
      return NextResponse.json(
        { ok: false, error: revert.error, burnId: burnRequestId },
        { status: 500 }
      )
    }
    return NextResponse.json({
      ok: true,
      burnId: burnRequestId,
      action: 'reverted',
      remintTxHash: revert.remintTxHash,
      feeBurnTxHash: revert.feeBurnTxHash,
    })
  }

  // ── mark_completed ────────────────────────────────────────────────────────
  if (action === 'mark_completed') {
    await db
      .update(burnRequests)
      .set({
        status: 'burned',
        payoutStatus: 'completed',
        payoutError: `${burn.payoutError ?? ''} | operator_marked_completed: ${body.notes ?? 'no_notes'}`,
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))

    await writeAuditLog(
      'burn.operator_marked_completed',
      'burn_request',
      burnRequestId,
      { operatorId: dbUser.id, notes: body.notes },
      dbUser.id,
    )

    return NextResponse.json({ ok: true, burnId: burnRequestId, action: 'marked_completed' })
  }

  // ── redispatch: pay the original withdrawal on the working rail ──────────
  if (action === 'redispatch') {
    if (burn.payoutStatus !== 'reconcile_required') {
      return NextResponse.json(
        { error: 'redispatch requires payout_status=reconcile_required', currentPayoutStatus: burn.payoutStatus },
        { status: 409 },
      )
    }
    if (burn.payoutReference) {
      // A reference means a dispatch may exist at the PSP — paying again
      // could double-pay. Resolve what that reference actually did first.
      return NextResponse.json(
        { error: 'row_has_payout_reference', message: 'A payout reference exists — resolve it via action=auto (or mark_completed/force_revert after checking the PSP) instead of redispatching.', payoutReference: burn.payoutReference },
        { status: 409 },
      )
    }
    if (burn.status !== 'burned') {
      return NextResponse.json(
        { error: 'burn_not_completed', message: `Burn status is '${burn.status}' — nothing to pay out.` },
        { status: 409 },
      )
    }
    if (!burn.recipientPhone) {
      return NextResponse.json({ error: 'no_recipient_phone' }, { status: 409 })
    }
    const receiveAmountTzs = burn.amountTzs - (burn.platformFeeTzs ?? 0) - (burn.nedaFeeTzs ?? 0) - PSP_FLAT_FEE_TZS
    if (receiveAmountTzs <= 0) {
      return NextResponse.json({ error: 'non_positive_receive_amount', receiveAmountTzs }, { status: 409 })
    }

    const phone = normalizePhone(burn.recipientPhone)
    const routed = await sendPayoutRouted({
      amountTzs: receiveAmountTzs,
      recipientPhone: phone,
      recipientName: 'nTZS User',
      narration: 'nTZS withdrawal',
      webhookBaseUrl: APP_URL,
      metadata: { burn_request_id: burnRequestId, operator_redispatch: true },
    })

    if (!routed.payout.success || !routed.payout.reference) {
      const reason = `${routed.payout.error ?? 'Payout initiation failed'} (rails tried: ${routed.attempted.join(' → ') || 'none'})`
      await db
        .update(burnRequests)
        .set({ payoutError: `${burn.payoutError ?? ''} | operator_redispatch_failed: ${reason}`, updatedAt: new Date() })
        .where(eq(burnRequests.id, burnRequestId))
      await writeAuditLog('burn.operator_redispatch_failed', 'burn_request', burnRequestId,
        { operatorId: dbUser.id, notes: body.notes, error: reason, receiveAmountTzs }, dbUser.id)
      return NextResponse.json({ ok: false, error: reason }, { status: 502 })
    }

    const ref = routed.payout.reference
    await db
      .update(burnRequests)
      .set({
        payoutReference: ref,
        payoutProvider: routed.provider,
        payoutStatus: 'pending',
        payoutError: `${burn.payoutError ?? ''} | operator_redispatched via ${routed.provider}: ${body.notes ?? 'no_notes'}`,
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))
    await writeAuditLog('burn.operator_redispatched', 'burn_request', burnRequestId,
      { operatorId: dbUser.id, notes: body.notes, rail: routed.provider, payoutReference: ref, receiveAmountTzs }, dbUser.id)

    // Short awaited poll so the operator sees the terminal state immediately;
    // the rail's webhook remains the durable finisher.
    for (const delay of [3000, 6000, 12000]) {
      await new Promise((r) => setTimeout(r, delay))
      try {
        const ps = await checkPayoutStatusFor(routed.provider, ref)
        if (ps.status === 'completed') {
          await db.update(burnRequests)
            .set({ payoutStatus: 'completed', status: 'burned', updatedAt: new Date() })
            .where(eq(burnRequests.id, burnRequestId))
          return NextResponse.json({ ok: true, action: 'redispatched', rail: routed.provider, payoutReference: ref, receiveAmountTzs, settled: 'completed' })
        }
        if (ps.status === 'failed' || ps.status === 'reversed') {
          await db.update(burnRequests)
            .set({ payoutStatus: 'reconcile_required', payoutError: `${burn.payoutError ?? ''} | operator_redispatch settled ${ps.status}: ${ps.failureReason ?? 'no reason'}`, updatedAt: new Date() })
            .where(eq(burnRequests.id, burnRequestId))
          return NextResponse.json({ ok: false, action: 'redispatched', rail: routed.provider, payoutReference: ref, settled: ps.status, failureReason: ps.failureReason }, { status: 502 })
        }
      } catch { /* keep polling */ }
    }
    return NextResponse.json({ ok: true, action: 'redispatched', rail: routed.provider, payoutReference: ref, receiveAmountTzs, settled: 'pending' })
  }

  // ── auto: only act on Snippe-authoritative states ────────────────────────
  // Allow the operator to supply a Snippe reference if our local row is
  // missing one (historical bug: sendPayout dropped references on error
  // responses). The endpoint then verifies that reference via Snippe's API
  // and only acts on terminal states — no blind trust.
  const effectiveReference = burn.payoutReference ?? body.snippeReference ?? null

  if (!effectiveReference) {
    return NextResponse.json(
      {
        ok: false,
        error: 'no_payout_reference',
        message:
          'No Snippe payout reference exists for this burn. Either supply one via { "snippeReference": "SN..." } after finding it in the Snippe dashboard, or — if you have confirmed in the dashboard that no payout exists at all — call this endpoint again with action=force_revert.',
        burn: {
          id: burn.id,
          amountTzs: burn.amountTzs,
          recipientPhone: burn.recipientPhone,
          createdAt: burn.createdAt,
          txHash: burn.txHash,
        },
      },
      { status: 409 }
    )
  }

  const snippeState = await checkPayoutStatus(effectiveReference)

  // If the operator supplied a new reference and Snippe confirms it's a
  // real payout, persist it to the row so future audits have a complete
  // paper trail.
  const shouldPersistReference = !burn.payoutReference && body.snippeReference
    && (snippeState.status === 'completed' || snippeState.status === 'failed' || snippeState.status === 'reversed')

  if (snippeState.status === 'completed') {
    await db
      .update(burnRequests)
      .set({
        status: 'burned',
        payoutStatus: 'completed',
        ...(shouldPersistReference ? { payoutReference: effectiveReference } : {}),
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))
    await writeAuditLog(
      'burn.reconciled_completed',
      'burn_request',
      burnRequestId,
      {
        operatorId: dbUser.id,
        snippeReference: effectiveReference,
        operatorSuppliedReference: Boolean(shouldPersistReference),
      },
      dbUser.id,
    )
    return NextResponse.json({ ok: true, action: 'marked_completed', snippeStatus: 'completed' })
  }

  if (snippeState.status === 'failed' || snippeState.status === 'reversed') {
    const revert = await revertOffRampBurn({
      burnRequestId,
      userAddress: userWallet.address,
      burnAmountTzs: burn.amountTzs,
      platformFeeTzs: burn.platformFeeTzs,
      feeRecipientAddress: burn.feeRecipientAddress,
      feeMintOccurred: Boolean(burn.feeTxHash),
      nedaFeeTzs: burn.nedaFeeTzs,
      nedaFeeMintOccurred: Boolean(burn.nedaFeeTxHash),
      reason: `reconcile: snippe_status=${snippeState.status} failure_reason=${snippeState.failureReason ?? 'n/a'} ref=${effectiveReference}`,
    })

    await db
      .update(burnRequests)
      .set({
        status: 'failed',
        payoutStatus: revert.error ? 'reconcile_required' : 'reverted',
        payoutError: revert.error
          ? `${burn.payoutError ?? ''} | reconcile_remint_failed: ${revert.error}`
          : `${burn.payoutError ?? ''} | reconcile_reverted (snippe: ${snippeState.status}, ref: ${effectiveReference})`,
        ...(shouldPersistReference ? { payoutReference: effectiveReference } : {}),
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))

    await writeAuditLog(
      revert.error ? 'burn.reconcile_revert_failed' : 'burn.reconciled_reverted',
      'burn_request',
      burnRequestId,
      {
        operatorId: dbUser.id,
        snippeReference: effectiveReference,
        operatorSuppliedReference: Boolean(shouldPersistReference),
        snippeStatus: snippeState.status,
        snippeFailureReason: snippeState.failureReason,
        remintTxHash: revert.remintTxHash,
        feeBurnTxHash: revert.feeBurnTxHash,
        remintError: revert.error,
      },
      dbUser.id,
    )

    if (revert.error) {
      return NextResponse.json(
        { ok: false, error: revert.error, snippeStatus: snippeState.status },
        { status: 500 }
      )
    }
    return NextResponse.json({
      ok: true,
      action: 'reverted',
      snippeStatus: snippeState.status,
      remintTxHash: revert.remintTxHash,
      feeBurnTxHash: revert.feeBurnTxHash,
    })
  }

  // snippeState.status === 'pending' (or we couldn't reach Snippe and the
  // helper defaulted to pending). Refuse to act.
  return NextResponse.json(
    {
      ok: false,
      error: 'snippe_status_pending_or_unknown',
      snippeStatus: snippeState.status,
      message:
        'Snippe has not confirmed a terminal state for this payout. Check the Snippe dashboard manually and retry, or use force_revert / mark_completed with notes once confirmed.',
    },
    { status: 409 }
  )
}

/**
 * GET /api/admin/burns/:id/reconcile
 * Read-only: returns the local burn row and Snippe's current view side-by-side.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAnyRole(['super_admin', 'platform_compliance'])
  const { id: burnRequestId } = await params

  const { db } = getDb()
  const [burn] = await db
    .select(RECONCILE_BURN_COLUMNS)
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (!burn) {
    return NextResponse.json({ error: 'Burn request not found' }, { status: 404 })
  }

  const snippeState = burn.payoutReference
    ? await checkPayoutStatus(burn.payoutReference)
    : null

  return NextResponse.json({
    burn: {
      id: burn.id,
      userId: burn.userId,
      walletId: burn.walletId,
      amountTzs: burn.amountTzs,
      platformFeeTzs: burn.platformFeeTzs,
      status: burn.status,
      payoutStatus: burn.payoutStatus,
      payoutReference: burn.payoutReference,
      payoutError: burn.payoutError,
      txHash: burn.txHash,
      feeTxHash: burn.feeTxHash,
      feeRecipientAddress: burn.feeRecipientAddress,
      recipientPhone: burn.recipientPhone,
      createdAt: burn.createdAt,
      updatedAt: burn.updatedAt,
    },
    snippe: snippeState,
  })
}
