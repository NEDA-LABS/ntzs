import { eq, and, or } from 'drizzle-orm'
import { ethers } from 'ethers'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import {
  BASE_RPC_URL,
  NTZS_CONTRACT_ADDRESS_BASE,
  MINTER_PRIVATE_KEY,
} from '@/lib/env'
import { verifyWebhookSignature, type AzamPayPayoutWebhookPayload } from '@/lib/psp/azampay'
import { burnRequests, auditLogs, wallets } from '@ntzs/db'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'

const NTZS_MINT_ABI = ['function mint(address to, uint256 amount)'] as const

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

  // ⚠ Verify AzamPay's actual signature and timestamp header names in sandbox.
  const signature = request.headers.get('x-webhook-signature') || ''
  const timestamp = request.headers.get('x-webhook-timestamp') || undefined

  if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
    console.error('[azampay/payout webhook] Invalid signature or misconfigured secret')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: AzamPayPayoutWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[azampay/payout webhook] Invalid JSON')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ⚠ These field paths are provisional — update once AzamPay sandbox payout
  // webhook deliveries have been observed and documented.
  //
  // Expected payload shape (to verify):
  //   payload.transactionId   → AzamPay transactionId (stored as payoutReference)
  //   payload.status          → 'SUCCESS' | 'FAILED' (verify exact string)
  //   payload.failureReason   → human-readable failure message
  //   payload.additionalProperties?.burn_request_id  → our burn_request_id
  //   payload.additionalProperties?.type             → 'treasury_withdrawal' (if applicable)

  const { db } = getDb()

  const metaType = (
    payload.additionalProperties?.type ?? payload.metadata?.type
  ) as string | undefined

  const isCompleted = String(payload.status ?? '').toUpperCase() === 'SUCCESS'
    || String(payload.type ?? '').includes('completed')
  const isFailed = String(payload.status ?? '').toUpperCase() === 'FAILED'
    || String(payload.type ?? '').includes('failed')

  // ── Treasury-withdrawal path ───────────────────────────────────────────────
  if (metaType === 'treasury_withdrawal') {
    const meta = payload.additionalProperties ?? payload.metadata ?? {}
    const partnerId = meta.partnerId as string | undefined
    const treasuryWallet = meta.treasuryWallet as string | undefined
    const metaAmount = Number(meta.amountTzs ?? NaN)
    const burnTxHash = meta.burnTxHash as string | undefined

    if (isFailed) {
      if (!partnerId || !treasuryWallet || !Number.isFinite(metaAmount) || metaAmount <= 0) {
        console.error('[azampay/payout webhook] treasury_withdrawal failure missing metadata', {
          partnerId, treasuryWallet, metaAmount, reference: payload.transactionId,
        })
        await db.insert(auditLogs).values({
          action: 'treasury_withdraw_reconcile_required',
          entityType: 'partner',
          entityId: partnerId ?? 'unknown',
          metadata: {
            reason: 'missing_metadata_on_async_failure',
            payoutReference: payload.transactionId,
            burnTxHash,
            failureReason: payload.failureReason,
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
            payoutReference: payload.transactionId,
            failureReason: payload.failureReason,
            via: 'async_webhook',
          },
        })
        console.log('[azampay/payout webhook] treasury_withdrawal reverted', {
          partnerId, amountTzs: metaAmount, remintTxHash,
        })
        return NextResponse.json({ status: 'success', reverted: true, remintTxHash })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[azampay/payout webhook] CRITICAL: async treasury_withdrawal remint failed — manual reconciliation required', {
          partnerId, amountTzs: metaAmount, burnTxHash, error: message,
        })
        await db.insert(auditLogs).values({
          action: 'treasury_withdraw_reconcile_required',
          entityType: 'partner',
          entityId: partnerId,
          metadata: {
            amountTzs: metaAmount,
            burnTxHash,
            payoutReference: payload.transactionId,
            failureReason: payload.failureReason,
            remintError: message,
          },
        })
        return NextResponse.json({ status: 'error', reconcile: true }, { status: 500 })
      }
    }

    if (isCompleted) {
      await db.insert(auditLogs).values({
        action: 'treasury_withdraw_completed',
        entityType: 'partner',
        entityId: partnerId ?? 'unknown',
        metadata: {
          amountTzs: metaAmount,
          burnTxHash,
          payoutReference: payload.transactionId,
        },
      })
    }
    return NextResponse.json({ status: 'acknowledged', type: payload.type })
  }

  // ── User off-ramp path (burn_requests) ─────────────────────────────────────
  const burnRequestId = (
    payload.additionalProperties?.burn_request_id ?? payload.metadata?.burn_request_id
  ) as string | undefined

  if (!burnRequestId) {
    console.warn('[azampay/payout webhook] Missing burn_request_id in payload')
    return NextResponse.json({ status: 'ignored', reason: 'no_burn_request_id' })
  }

  console.log(`[azampay/payout webhook] status=${payload.status} type=${payload.type} for burn ${burnRequestId}`, {
    transactionId: payload.transactionId,
  })

  const [burn] = await db
    .select()
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (!burn) {
    console.warn(`[azampay/payout webhook] Burn request not found: ${burnRequestId}`)
    return NextResponse.json({ status: 'ignored', reason: 'not_found' })
  }

  if (
    burn.payoutStatus === 'completed' ||
    burn.payoutStatus === 'reverted' ||
    burn.payoutStatus === 'reverting' ||
    burn.payoutStatus === 'reconcile_required'
  ) {
    console.warn(`[azampay/payout webhook] Already finalized: ${burnRequestId} (${burn.payoutStatus})`)
    return NextResponse.json({ status: 'ignored', reason: 'already_finalized' })
  }

  if (isCompleted) {
    await db
      .update(burnRequests)
      .set({ status: 'burned', payoutStatus: 'completed', updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))

    await db.insert(auditLogs).values({
      action: 'payout_completed',
      entityType: 'burn_request',
      entityId: burnRequestId,
      metadata: { payoutReference: payload.transactionId, amountTzs: burn.amountTzs },
    })

    console.log(`[azampay/payout webhook] Burn ${burnRequestId} payout completed`)
    return NextResponse.json({ status: 'success', burnId: burnRequestId, payoutStatus: 'completed' })
  }

  if (isFailed) {
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
      console.warn(`[azampay/payout webhook] Revert already claimed by another path: ${burnRequestId}`)
      return NextResponse.json({ status: 'ignored', reason: 'already_reverting' })
    }

    const [userWallet] = await db
      .select({ address: wallets.address })
      .from(wallets)
      .where(eq(wallets.id, burn.walletId))
      .limit(1)

    if (!userWallet) {
      console.error('[azampay/payout webhook] CRITICAL: wallet missing for burn request', { burnRequestId })
      await db
        .update(burnRequests)
        .set({
          status: 'failed',
          payoutStatus: 'reconcile_required',
          payoutError: `wallet_not_found | ${payload.failureReason ?? ''}`,
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
      reason: payload.failureReason || 'Payout failed (webhook)',
    })

    await db
      .update(burnRequests)
      .set({
        status: 'failed',
        payoutStatus: revert.error ? 'reconcile_required' : 'reverted',
        payoutError: revert.error
          ? `${payload.failureReason ?? 'payout_failed'} | remint_error: ${revert.error}`
          : payload.failureReason || 'Payout failed',
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))

    await db.insert(auditLogs).values({
      action: revert.error ? 'payout_failed_reconcile_required' : 'payout_failed_reverted',
      entityType: 'burn_request',
      entityId: burnRequestId,
      metadata: {
        payoutReference: payload.transactionId,
        amountTzs: burn.amountTzs,
        failureReason: payload.failureReason,
        remintTxHash: revert.remintTxHash,
        feeBurnTxHash: revert.feeBurnTxHash,
        remintError: revert.error,
      },
    })

    console.log(`[azampay/payout webhook] Burn ${burnRequestId} payout reverted`, {
      reason: payload.failureReason,
      remintTxHash: revert.remintTxHash,
      remintError: revert.error,
    })
    return NextResponse.json({
      status: revert.error ? 'reconcile_required' : 'reverted',
      burnId: burnRequestId,
    })
  }

  return NextResponse.json({ status: 'acknowledged', type: payload.type, statusValue: payload.status })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'azampay-payout-webhook' })
}
