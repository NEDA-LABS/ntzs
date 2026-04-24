import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { checkPayoutStatus } from '@/lib/psp/snippe'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'
import { writeAuditLog } from '@/lib/audit'
import { burnRequests, wallets } from '@ntzs/db'

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
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const dbUser = await requireAnyRole(['super_admin', 'platform_compliance'])
  const { id: burnRequestId } = await params

  let body: {
    action?: 'auto' | 'force_revert' | 'mark_completed'
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
    .select()
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
    .select()
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
