import { eq, and, or } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, BURNER_PRIVATE_KEY, PLATFORM_TREASURY_ADDRESS } from '@/lib/env'
import { authenticatePartner } from '@/lib/waas/auth'
import { isValidTanzanianPhone } from '@/lib/psp/snippe'
import { wallets, partnerUsers, burnRequests, partners } from '@ntzs/db'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'

const SAFE_MINT_THRESHOLD_TZS = 100000
const SNIPPE_FLAT_FEE_TZS = 1500
const DEFAULT_PLATFORM_FEE_PERCENT = 0.5
const SNIPPE_API_KEY = process.env.SNIPPE_API_KEY || ''
const SNIPPE_BASE_URL = 'https://api.snippe.sh'
const APP_URL = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''

const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const
const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

/**
 * POST /api/v1/withdrawals — Initiate nTZS burn + Snippe payout to M-Pesa (off-ramp)
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult

  let body: { userId: string; amountTzs: number; phoneNumber: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { userId, amountTzs: receiveAmountRaw, phoneNumber } = body

  if (!userId || !receiveAmountRaw || !phoneNumber) {
    return NextResponse.json(
      { error: 'userId, amountTzs, and phoneNumber are required' },
      { status: 400 }
    )
  }

  // amountTzs in the request is the amount the recipient should RECEIVE on mobile money.
  const receiveAmountTzs = Math.trunc(Number(receiveAmountRaw))
  if (!Number.isFinite(receiveAmountTzs) || receiveAmountTzs < 5000) {
    return NextResponse.json(
      { error: 'Minimum withdrawal amount is 5,000 TZS (recipient net)' },
      { status: 400 }
    )
  }

  if (!isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json(
      { error: 'Invalid Tanzanian phone number' },
      { status: 400 }
    )
  }

  const { db } = getDb()

  // Verify user belongs to this partner
  const [mapping] = await db
    .select({ externalId: partnerUsers.externalId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, userId)))
    .limit(1)

  if (!mapping) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Load partner fee config + treasury
  const [partnerRow] = await db
    .select({ feePercent: partners.feePercent, treasuryWalletAddress: partners.treasuryWalletAddress })
    .from(partners)
    .where(eq(partners.id, partner.id))
    .limit(1)

  const partnerFeePercentRaw = partnerRow ? parseFloat(String(partnerRow.feePercent ?? '0')) : 0
  const feePercent = partnerFeePercentRaw > 0 ? partnerFeePercentRaw : DEFAULT_PLATFORM_FEE_PERCENT
  const feeRecipient = ethers.isAddress(partnerRow?.treasuryWalletAddress ?? '')
    ? partnerRow!.treasuryWalletAddress!
    : ethers.isAddress(PLATFORM_TREASURY_ADDRESS)
      ? PLATFORM_TREASURY_ADDRESS
      : null

  // Gross-up: burnAmount = ceil((receive + snippeFee) / (1 - feeRate))
  const burnAmountTzs = Math.ceil((receiveAmountTzs + SNIPPE_FLAT_FEE_TZS) / (1 - feePercent / 100))
  const platformFeeTzs = burnAmountTzs - receiveAmountTzs - SNIPPE_FLAT_FEE_TZS

  // Get wallet
  const [wallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)

  if (!wallet || wallet.address.startsWith('0x_pending_')) {
    return NextResponse.json(
      { error: 'User wallet is not provisioned yet' },
      { status: 400 }
    )
  }

  // Check on-chain balance
  const rpcUrl = BASE_RPC_URL
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(contractAddress, NTZS_BALANCE_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(wallet.address)
    const balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))

    if (balanceTzs < burnAmountTzs) {
      return NextResponse.json(
        {
          error: 'insufficient_balance',
          message: `Insufficient balance. Available: ${balanceTzs} TZS, need ${burnAmountTzs} TZS to pay out ${receiveAmountTzs} TZS (incl. fees).`,
          details: { available: balanceTzs, required: burnAmountTzs, receiveAmountTzs, platformFeeTzs, snippeFeeTzs: SNIPPE_FLAT_FEE_TZS },
        },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[v1/withdrawals] Balance check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to verify balance' }, { status: 500 })
  }

  // Large amounts require admin approval — queue and return
  if (burnAmountTzs >= SAFE_MINT_THRESHOLD_TZS) {
    const [burn] = await db
      .insert(burnRequests)
      .values({
        userId,
        walletId: wallet.id,
        chain: 'base',
        contractAddress,
        amountTzs: burnAmountTzs,
        reason: 'WaaS withdrawal',
        status: 'requested',
        requestedByUserId: userId,
        recipientPhone: phoneNumber,
        platformFeeTzs,
      })
      .returning({ id: burnRequests.id, status: burnRequests.status, amountTzs: burnRequests.amountTzs })

    if (!burn) {
      return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
    }

    return NextResponse.json(
      {
        id: burn.id,
        status: burn.status,
        amountTzs: burn.amountTzs,
        receiveAmountTzs,
        platformFeeTzs,
        snippeFeeTzs: SNIPPE_FLAT_FEE_TZS,
        message: 'Withdrawal requires admin approval for amounts >= 100,000 TZS.',
      },
      { status: 201 }
    )
  }

  // Small amounts: execute burn inline immediately
  const burnerKey = BURNER_PRIVATE_KEY || MINTER_PRIVATE_KEY
  if (!burnerKey) {
    return NextResponse.json({ error: 'Burn executor not configured' }, { status: 500 })
  }

  // Create burn request in burn_submitted state
  const [burn] = await db
    .insert(burnRequests)
    .values({
      userId,
      walletId: wallet.id,
      chain: 'base',
      contractAddress,
      amountTzs: burnAmountTzs,
      reason: 'WaaS withdrawal',
      status: 'burn_submitted',
      requestedByUserId: userId,
      recipientPhone: phoneNumber,
      platformFeeTzs,
    })
    .returning({ id: burnRequests.id, amountTzs: burnRequests.amountTzs })

  if (!burn) {
    return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
  }

  const burnRequestId = burn.id

  // Execute burn on-chain
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const signer = new ethers.Wallet(burnerKey, provider)
    const token = new ethers.Contract(contractAddress, NTZS_BURN_ABI, signer)

    const burnerRole: string = await token.BURNER_ROLE()
    const hasBurner: boolean = await token.hasRole(burnerRole, await signer.getAddress())
    if (!hasBurner) {
      await db.update(burnRequests).set({ status: 'failed', error: 'Burn key lacks BURNER_ROLE', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
      return NextResponse.json({ error: 'Burn executor not configured correctly' }, { status: 500 })
    }

    const amountWei = BigInt(String(burnAmountTzs)) * BigInt(10) ** BigInt(18)
    const tx = await token.burn(wallet.address, amountWei)

    await db.update(burnRequests).set({ txHash: tx.hash, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))

    await tx.wait(1)

    await db.update(burnRequests).set({ status: 'burned', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))

    // ── Mint platform fee to partner-or-global treasury (best-effort) ──────
    if (platformFeeTzs > 0 && feeRecipient) {
      try {
        const feeAmountWei = BigInt(platformFeeTzs) * BigInt(10) ** BigInt(18)
        const feeTx = await token.mint(feeRecipient, feeAmountWei)
        await feeTx.wait(1)
        await db
          .update(burnRequests)
          .set({ feeTxHash: feeTx.hash, feeRecipientAddress: feeRecipient, updatedAt: new Date() })
          .where(eq(burnRequests.id, burnRequestId))
      } catch (feeErr) {
        const msg = feeErr instanceof Error ? feeErr.message : String(feeErr)
        console.error('[v1/withdrawals] fee mint failed (non-fatal):', msg)
      }
    } else if (platformFeeTzs > 0) {
      console.warn('[v1/withdrawals] no treasury address configured — platform fee kept as implicit reserve surplus', { burnRequestId, platformFeeTzs })
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.update(burnRequests).set({ status: 'failed', error: errorMessage, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    console.error('[v1/withdrawals] Burn failed:', errorMessage)
    return NextResponse.json({ error: 'Burn failed', detail: errorMessage }, { status: 500 })
  }

  // Track whether the platform fee was actually minted so a later revert
  // knows whether to burn it back.
  const feeMintedRef = { occurred: false }

  // Re-read flag from DB (since the fee mint block above only set this
  // conditionally); cheaper to just read it back once.
  {
    const [row] = await db
      .select({ feeTxHash: burnRequests.feeTxHash })
      .from(burnRequests)
      .where(eq(burnRequests.id, burnRequestId))
      .limit(1)
    feeMintedRef.occurred = Boolean(row?.feeTxHash)
  }

  // Helper: transition payoutStatus 'pending' → 'reverted' atomically.
  // Returns true if we were the one that flipped it (i.e. caller should
  // perform the revert on-chain). Guards against double-revert if both the
  // polling loop and the webhook fire.
  const claimRevert = async (): Promise<boolean> => {
    const updated = await db
      .update(burnRequests)
      .set({ payoutStatus: 'reverting', updatedAt: new Date() })
      .where(
        and(
          eq(burnRequests.id, burnRequestId),
          // Only claim if no one has already finalized this payout.
          // payoutStatus is text, so compare against the known non-final states.
          or(
            eq(burnRequests.payoutStatus, 'pending'),
            eq(burnRequests.payoutStatus, 'failed'),
          ),
        )
      )
      .returning({ id: burnRequests.id })
    return updated.length > 0
  }

  const finalizeRevert = async (reason: string, remintTxHash?: string, feeBurnTxHash?: string, remintError?: string) => {
    await db
      .update(burnRequests)
      .set({
        status: 'failed',
        payoutStatus: remintError ? 'reconcile_required' : 'reverted',
        payoutError: remintError ? `${reason} | remint_error: ${remintError}` : reason,
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))
    console.log('[v1/withdrawals] burn reverted', {
      burnRequestId, reason, remintTxHash, feeBurnTxHash, remintError,
    })
  }

  const revertBurnForUser = async (reason: string) => {
    const claimed = await claimRevert()
    if (!claimed) return // already finalized by another path
    const res = await revertOffRampBurn({
      burnRequestId,
      userAddress: wallet.address,
      burnAmountTzs,
      platformFeeTzs,
      feeRecipientAddress: feeRecipient,
      feeMintOccurred: feeMintedRef.occurred,
      reason,
    })
    await finalizeRevert(reason, res.remintTxHash, res.feeBurnTxHash, res.error)
  }

  // Trigger Snippe payout
  if (SNIPPE_API_KEY) {
    let phone = phoneNumber.replace(/[\s\-+]/g, '')
    if (phone.startsWith('0')) phone = '255' + phone.substring(1)
    if (!phone.startsWith('255')) phone = '255' + phone

    const webhookUrl = `${APP_URL}/api/webhooks/snippe/payout`

    try {
      const payoutResp = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SNIPPE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Snippe `amount` = net to recipient; Snippe debits its flat fee separately.
          amount: receiveAmountTzs,
          channel: 'mobile',
          recipient_phone: phone,
          recipient_name: 'nTZS User',
          narration: 'nTZS withdrawal',
          ...(webhookUrl.startsWith('https://') ? { webhook_url: webhookUrl } : {}),
          metadata: { burn_request_id: burnRequestId },
        }),
      })
      const payoutResult = await payoutResp.json() as { status: string; message?: string; data?: { reference: string } }

      if (payoutResult.status === 'success' && payoutResult.data?.reference) {
        const payoutRef = payoutResult.data.reference
        await db.update(burnRequests).set({ payoutReference: payoutRef, payoutStatus: 'pending', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))

        // Poll Snippe for completion — don't rely solely on webhook
        // Checks at 3s, 6s, 12s intervals to catch quick completions
        void (async () => {
          const delays = [3000, 6000, 12000]
          for (const delay of delays) {
            await new Promise((r) => setTimeout(r, delay))
            try {
              const statusResp = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/${payoutRef}`, {
                headers: { 'Authorization': `Bearer ${SNIPPE_API_KEY}` },
                signal: AbortSignal.timeout(5000),
              })
              const statusResult = await statusResp.json() as { status: string; data?: { status: string; failure_reason?: string } }
              if (statusResult.status !== 'success' || !statusResult.data) continue
              const ps = statusResult.data.status
              if (ps === 'completed') {
                await db.update(burnRequests).set({ payoutStatus: 'completed', status: 'burned', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
                console.log(`[v1/withdrawals] Payout ${payoutRef} completed (polled)`)
                break
              } else if (ps === 'failed' || ps === 'reversed') {
                console.warn(`[v1/withdrawals] Payout ${payoutRef} failed (polled): ${statusResult.data.failure_reason}`)
                await revertBurnForUser(statusResult.data.failure_reason || 'Payout failed (polled)')
                break
              }
            } catch {
              // Continue to next poll interval
            }
          }
        })()
      } else {
        // Snippe returned an error body from /v1/payouts/send. We do NOT
        // auto-revert here: a non-success HTTP response is ambiguous
        // (could be a clean reject, could be a partial dispatch). Only
        // signed webhook events or status-endpoint `failed`/`reversed`
        // values are authoritative. Mark for reconciliation and let an
        // operator verify with Snippe before touching funds.
        const reason = payoutResult.message ?? 'Payout initiation failed'
        console.error('[v1/withdrawals] Payout initiation failed (NOT auto-reverting):', reason)
        await db
          .update(burnRequests)
          .set({
            payoutStatus: 'reconcile_required',
            payoutError: reason,
            updatedAt: new Date(),
          })
          .where(eq(burnRequests.id, burnRequestId))
      }
    } catch (payoutErr) {
      // Network / fetch exception — state is unknown. Same rule: no
      // auto-revert, mark for reconciliation.
      const msg = payoutErr instanceof Error ? payoutErr.message : String(payoutErr)
      console.error('[v1/withdrawals] Payout error (NOT auto-reverting):', msg)
      await db
        .update(burnRequests)
        .set({
          payoutStatus: 'reconcile_required',
          payoutError: msg,
          updatedAt: new Date(),
        })
        .where(eq(burnRequests.id, burnRequestId))
    }
  }

  // Re-read final state. Auto-reverts (polling loop) and reconcile-required
  // (ambiguous sync failure) both need to be surfaced to the caller.
  const [finalRow] = await db
    .select({
      status: burnRequests.status,
      payoutStatus: burnRequests.payoutStatus,
      payoutError: burnRequests.payoutError,
    })
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (finalRow?.payoutStatus === 'reverted') {
    return NextResponse.json(
      {
        id: burnRequestId,
        status: finalRow.status,
        payoutStatus: finalRow.payoutStatus,
        error: finalRow.payoutError || 'Payout failed; burn reverted.',
      },
      { status: 502 }
    )
  }

  if (finalRow?.payoutStatus === 'reconcile_required') {
    return NextResponse.json(
      {
        id: burnRequestId,
        status: finalRow.status,
        payoutStatus: finalRow.payoutStatus,
        error: finalRow.payoutError || 'Payout could not be dispatched',
        message:
          'Withdrawal is under review. On-chain burn completed but PSP did not confirm the payout. Do not retry — an operator will confirm with the PSP and either complete the payout or restore your balance.',
      },
      { status: 502 }
    )
  }

  return NextResponse.json(
    {
      id: burnRequestId,
      status: 'burned',
      amountTzs: burn.amountTzs,
      receiveAmountTzs,
      platformFeeTzs,
      snippeFeeTzs: SNIPPE_FLAT_FEE_TZS,
      feeRecipient,
      message: 'Withdrawal processed successfully.',
    },
    { status: 201 }
  )
}
