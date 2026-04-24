import { eq, and, or } from 'drizzle-orm'
import { ethers } from 'ethers'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import {
  BASE_RPC_URL,
  NTZS_CONTRACT_ADDRESS_BASE,
  MINTER_PRIVATE_KEY,
} from '@/lib/env'
import { verifyWebhookSignature, type SnippePayoutWebhookPayload } from '@/lib/psp/snippe'
import { burnRequests, auditLogs, wallets } from '@ntzs/db'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'

const NTZS_MINT_ABI = ['function mint(address to, uint256 amount)'] as const

/**
 * Re-mint previously-burned nTZS to a partner's treasury when a treasury
 * withdrawal payout fails asynchronously (i.e. Snippe accepted it but
 * later marked it failed/reversed).
 * Returns the mint tx hash on success.
 */
async function remintTreasury(amountTzs: number, treasuryWallet: string): Promise<string> {
  if (!MINTER_PRIVATE_KEY || !BASE_RPC_URL || !NTZS_CONTRACT_ADDRESS_BASE) {
    throw new Error('Mint executor not configured')
  }
  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
  const signer = new ethers.Wallet(MINTER_PRIVATE_KEY, provider)
  const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, NTZS_MINT_ABI, signer)
  const amountWei = BigInt(Math.trunc(amountTzs)) * (BigInt(10) ** BigInt(18))
  const tx = await token.mint(treasuryWallet, amountWei)
  await tx.wait(1)
  return tx.hash
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-webhook-signature') || ''
  const timestamp = request.headers.get('x-webhook-timestamp') || undefined

  // Verify HMAC signature — `verifyWebhookSignature` fails closed on missing
  // secret, bad signature, or stale timestamp.
  if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
    console.error('[snippe/payout webhook] Invalid signature or misconfigured secret')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: SnippePayoutWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[snippe/payout webhook] Invalid JSON')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, data } = payload

  const { db } = getDb()

  // ── Treasury-withdrawal path ───────────────────────────────────────────────
  // The withdraw route burns nTZS BEFORE calling Snippe. If Snippe
  // asynchronously reports failure, we must re-mint so the partner is made
  // whole. These payouts are identified by metadata.type === 'treasury_withdrawal'.
  const metaType = data?.metadata?.type as string | undefined
  if (metaType === 'treasury_withdrawal') {
    const partnerId = data.metadata?.partnerId as string | undefined
    const treasuryWallet = data.metadata?.treasuryWallet as string | undefined
    const metaAmount = Number(data.metadata?.amountTzs ?? NaN)
    const burnTxHash = data.metadata?.burnTxHash as string | undefined

    if (type === 'payout.failed' || data.status === 'failed') {
      if (!partnerId || !treasuryWallet || !Number.isFinite(metaAmount) || metaAmount <= 0) {
        console.error('[snippe/payout webhook] treasury_withdrawal failure missing metadata', {
          partnerId, treasuryWallet, metaAmount, reference: data.reference,
        })
        await db.insert(auditLogs).values({
          action: 'treasury_withdraw_reconcile_required',
          entityType: 'partner',
          entityId: partnerId ?? 'unknown',
          metadata: {
            reason: 'missing_metadata_on_async_failure',
            payoutReference: data.reference,
            burnTxHash,
            failureReason: data.failure_reason,
          },
        })
        return NextResponse.json({ status: 'acknowledged', reconcile: true })
      }

      try {
        const remintTxHash = await remintTreasury(metaAmount, treasuryWallet)
        await db.insert(auditLogs).values({
          action: 'treasury_withdraw_reverted',
          entityType: 'partner',
          entityId: partnerId,
          metadata: {
            amountTzs: metaAmount,
            burnTxHash,
            remintTxHash,
            payoutReference: data.reference,
            failureReason: data.failure_reason,
            via: 'async_webhook',
          },
        })
        console.log('[snippe/payout webhook] treasury_withdrawal reverted', {
          partnerId, amountTzs: metaAmount, remintTxHash,
        })
        return NextResponse.json({ status: 'success', reverted: true, remintTxHash })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[snippe/payout webhook] CRITICAL: async treasury_withdrawal remint failed — manual reconciliation required', {
          partnerId, amountTzs: metaAmount, burnTxHash, error: message,
        })
        await db.insert(auditLogs).values({
          action: 'treasury_withdraw_reconcile_required',
          entityType: 'partner',
          entityId: partnerId,
          metadata: {
            amountTzs: metaAmount,
            burnTxHash,
            payoutReference: data.reference,
            failureReason: data.failure_reason,
            remintError: message,
          },
        })
        return NextResponse.json({ status: 'error', reconcile: true }, { status: 500 })
      }
    }

    // Completed — just log for traceability.
    if (type === 'payout.completed' && data.status === 'completed') {
      await db.insert(auditLogs).values({
        action: 'treasury_withdraw_completed',
        entityType: 'partner',
        entityId: partnerId ?? 'unknown',
        metadata: {
          amountTzs: metaAmount,
          burnTxHash,
          payoutReference: data.reference,
        },
      })
    }
    return NextResponse.json({ status: 'acknowledged', type })
  }

  // ── User off-ramp path (burn_requests) ─────────────────────────────────────
  // Extract our burn_request_id from metadata
  const burnRequestId = data?.metadata?.burn_request_id as string
  if (!burnRequestId) {
    console.warn('[snippe/payout webhook] Missing burn_request_id in metadata')
    return NextResponse.json({ status: 'ignored', reason: 'no_burn_request_id' })
  }

  console.log(`[snippe/payout webhook] ${type} for burn ${burnRequestId}`, {
    reference: data.reference,
    status: data.status,
  })

  // Fetch the burn request
  const [burn] = await db
    .select()
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (!burn) {
    console.warn(`[snippe/payout webhook] Burn request not found: ${burnRequestId}`)
    return NextResponse.json({ status: 'ignored', reason: 'not_found' })
  }

  // Idempotency: skip if payout already finalized (either completed or
  // already reverted / requires manual reconciliation).
  if (
    burn.payoutStatus === 'completed' ||
    burn.payoutStatus === 'reverted' ||
    burn.payoutStatus === 'reverting' ||
    burn.payoutStatus === 'reconcile_required'
  ) {
    console.warn(`[snippe/payout webhook] Already finalized: ${burnRequestId} (${burn.payoutStatus})`)
    return NextResponse.json({ status: 'ignored', reason: 'already_finalized' })
  }

  if (type === 'payout.completed' && data.status === 'completed') {
    await db
      .update(burnRequests)
      .set({
        status: 'burned',
        payoutStatus: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))

    await db.insert(auditLogs).values({
      action: 'payout_completed',
      entityType: 'burn_request',
      entityId: burnRequestId,
      metadata: {
        payoutReference: data.reference,
        amountTzs: burn.amountTzs,
      },
    })

    console.log(`[snippe/payout webhook] Burn ${burnRequestId} payout completed`)
    return NextResponse.json({ status: 'success', burnId: burnRequestId, payoutStatus: 'completed' })
  }

  if (type === 'payout.failed' || data.status === 'failed') {
    // Atomically claim the revert so we don't double-refund if the
    // inline polling loop in /api/v1/withdrawals already started one.
    const claim = await db
      .update(burnRequests)
      .set({ payoutStatus: 'reverting', updatedAt: new Date() })
      .where(
        and(
          eq(burnRequests.id, burnRequestId),
          or(
            eq(burnRequests.payoutStatus, 'pending'),
            eq(burnRequests.payoutStatus, 'failed'),
          ),
        )
      )
      .returning({ id: burnRequests.id })

    if (claim.length === 0) {
      console.warn(`[snippe/payout webhook] Revert already claimed by another path: ${burnRequestId}`)
      return NextResponse.json({ status: 'ignored', reason: 'already_reverting' })
    }

    // Look up the user's wallet address so we can re-mint.
    const [userWallet] = await db
      .select({ address: wallets.address })
      .from(wallets)
      .where(eq(wallets.id, burn.walletId))
      .limit(1)

    if (!userWallet) {
      console.error('[snippe/payout webhook] CRITICAL: wallet missing for burn request', { burnRequestId })
      await db
        .update(burnRequests)
        .set({
          status: 'failed',
          payoutStatus: 'reconcile_required',
          payoutError: `wallet_not_found | ${data.failure_reason ?? ''}`,
          updatedAt: new Date(),
        })
        .where(eq(burnRequests.id, burnRequestId))
      return NextResponse.json({ status: 'error', reconcile: true }, { status: 500 })
    }

    const revert = await revertOffRampBurn({
      burnRequestId,
      userAddress: userWallet.address,
      burnAmountTzs: burn.amountTzs,
      platformFeeTzs: burn.platformFeeTzs,
      feeRecipientAddress: burn.feeRecipientAddress,
      feeMintOccurred: Boolean(burn.feeTxHash),
      reason: data.failure_reason || 'Payout failed (webhook)',
    })

    await db
      .update(burnRequests)
      .set({
        status: 'failed',
        payoutStatus: revert.error ? 'reconcile_required' : 'reverted',
        payoutError: revert.error
          ? `${data.failure_reason ?? 'payout_failed'} | remint_error: ${revert.error}`
          : data.failure_reason || 'Payout failed',
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))

    await db.insert(auditLogs).values({
      action: revert.error ? 'payout_failed_reconcile_required' : 'payout_failed_reverted',
      entityType: 'burn_request',
      entityId: burnRequestId,
      metadata: {
        payoutReference: data.reference,
        amountTzs: burn.amountTzs,
        failureReason: data.failure_reason,
        remintTxHash: revert.remintTxHash,
        feeBurnTxHash: revert.feeBurnTxHash,
        remintError: revert.error,
      },
    })

    console.log(`[snippe/payout webhook] Burn ${burnRequestId} payout reverted`, {
      reason: data.failure_reason,
      remintTxHash: revert.remintTxHash,
      remintError: revert.error,
    })
    return NextResponse.json({
      status: revert.error ? 'reconcile_required' : 'reverted',
      burnId: burnRequestId,
    })
  }

  return NextResponse.json({ status: 'acknowledged', type })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'snippe-payout-webhook' })
}
