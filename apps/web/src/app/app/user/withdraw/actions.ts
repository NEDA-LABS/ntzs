'use server'

import { and, eq } from 'drizzle-orm'
import { ethers } from 'ethers'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, PLATFORM_TREASURY_ADDRESS } from '@/lib/env'
import { burnRequests, kycCases, wallets } from '@ntzs/db'
import { isValidTanzanianPhone, normalizePhone, sendPayout } from '@/lib/psp/snippe'
import { writeAuditLog } from '@/lib/audit'

const SAFE_BURN_THRESHOLD_TZS = 100000
const PLATFORM_FEE_PERCENT = 0.5
const SNIPPE_FLAT_FEE_TZS = 1500
const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''

const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function paused() view returns (bool)',
] as const

export type WithdrawActionResult =
  | { success: true; requiresApproval: boolean }
  | { success: false; error: string }

export async function createWithdrawRequestAction(formData: FormData): Promise<WithdrawActionResult> {
  try {
    return await _createWithdrawRequestAction(formData)
  } catch (err) {
    // Next.js redirect() and notFound() throw special errors — let them propagate
    if (err instanceof Error && 'digest' in err && typeof (err as { digest?: string }).digest === 'string') {
      throw err
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[withdraw] unhandled error in createWithdrawRequestAction', msg)
    return { success: false, error: `Withdrawal failed: ${msg}` }
  }
}

async function _createWithdrawRequestAction(formData: FormData): Promise<WithdrawActionResult> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const amountTzsRaw = String(formData.get('amountTzs') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()

  // amountTzsRaw is the amount the user wants to RECEIVE on mobile money
  const receiveAmountTzs = Number(amountTzsRaw)
  if (!Number.isFinite(receiveAmountTzs) || receiveAmountTzs < 5000) {
    return { success: false, error: 'Minimum receive amount is 5,000 TZS' }
  }

  if (!phone) {
    return { success: false, error: 'Phone number is required for mobile money payout' }
  }
  if (!isValidTanzanianPhone(phone)) {
    return { success: false, error: 'Invalid Tanzanian mobile number' }
  }

  const { db } = getDb()

  const wallet = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, dbUser.id), eq(wallets.chain, 'base')),
  })
  if (!wallet) redirect('/app/user/wallet')

  const approvedKyc = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .where(and(eq(kycCases.userId, dbUser.id), eq(kycCases.status, 'approved')))
    .limit(1)
  if (!approvedKyc.length) redirect('/app/user/kyc')

  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
  if (!contractAddress) return { success: false, error: 'Contract not configured' }

  const recipientPhone = normalizePhone(phone)

  // Gross-up: user specifies receive amount, we calculate how much nTZS to burn
  // burnAmount = ceil((receiveAmount + snippeFee) / (1 - platformFeeRate))
  const receiveAmountTrunc = Math.trunc(receiveAmountTzs)
  const amountTzsTrunc = Math.ceil((receiveAmountTrunc + SNIPPE_FLAT_FEE_TZS) / (1 - PLATFORM_FEE_PERCENT / 100))
  const platformFeeTzs = amountTzsTrunc - receiveAmountTrunc - SNIPPE_FLAT_FEE_TZS
  // Snippe's `amount` = net amount the recipient receives; Snippe debits its flat fee
  // separately on top of this from our Snippe balance. So we pass the exact receive amount.
  const payoutAmountTzs = receiveAmountTrunc

  // Large amounts require admin approval — queue and exit
  if (amountTzsTrunc >= SAFE_BURN_THRESHOLD_TZS) {
    const [queuedBurn] = await db.insert(burnRequests).values({
      userId: dbUser.id,
      walletId: wallet.id,
      chain: wallet.chain,
      contractAddress,
      amountTzs: amountTzsTrunc,
      reason: 'User withdrawal',
      status: 'requires_second_approval',
      requestedByUserId: dbUser.id,
      recipientPhone,
      platformFeeTzs,
    }).returning({ id: burnRequests.id })
    await writeAuditLog('burn.queued_for_approval', 'burn_request', queuedBurn.id, { amountTzs: amountTzsTrunc, receiveAmountTzs: receiveAmountTrunc, platformFeeTzs }, dbUser.id)
    return { success: true as const, requiresApproval: true }
  }


  // ── Small amounts: execute burn + payout inline ──────────────────────────

  const rpcUrl = BASE_RPC_URL
  const privateKey = MINTER_PRIVATE_KEY
  if (!rpcUrl || !privateKey) return { success: false, error: 'Burn executor not configured' }

  // Pre-flight on-chain balance check — avoids cryptic revert messages
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(contractAddress, NTZS_BURN_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(wallet.address)
    const balanceTzs = balanceWei / (BigInt(10) ** BigInt(18))
    if (balanceTzs < BigInt(amountTzsTrunc)) {
      return {
        success: false,
        error: `Insufficient balance. You have ${balanceTzs.toString()} nTZS but need ${amountTzsTrunc.toLocaleString()} nTZS to withdraw ${receiveAmountTrunc.toLocaleString()} TZS (including fees).`,
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Could not verify balance: ${msg}` }
  }

  // Create burn request record first (so we have an ID for the audit trail)
  const [burnReq] = await db
    .insert(burnRequests)
    .values({
      userId: dbUser.id,
      walletId: wallet.id,
      chain: wallet.chain,
      contractAddress,
      amountTzs: amountTzsTrunc,
      reason: 'User withdrawal',
      status: 'burn_submitted',
      requestedByUserId: dbUser.id,
      recipientPhone,
      platformFeeTzs,
    })
    .returning({ id: burnRequests.id })

  const burnRequestId = burnReq.id

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const signer = new ethers.Wallet(privateKey, provider)
    const token = new ethers.Contract(contractAddress, NTZS_BURN_ABI, signer)

    const paused: boolean = await token.paused()
    if (paused) throw new Error('Token is paused — withdrawals temporarily disabled')

    const burnerRole: string = await token.BURNER_ROLE()
    const hasBurner: boolean = await token.hasRole(burnerRole, await signer.getAddress())
    if (!hasBurner) throw new Error('Burn key lacks BURNER_ROLE — contact support')

    const amountWei = BigInt(amountTzsTrunc) * BigInt(10) ** BigInt(18)
    const tx = await token.burn(wallet.address, amountWei)

    await db
      .update(burnRequests)
      .set({ txHash: tx.hash, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))

    await tx.wait(1)

    await db
      .update(burnRequests)
      .set({ status: 'burned', updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))

    // ── Mint platform fee to treasury (best-effort, non-fatal) ────────────
    // Preserves 1:1 backing: net supply change = -(burn - feeMint) = -payoutAmount
    // NOTE: we submit the TX but do NOT await feeTx.wait(1) — waiting for
    // on-chain confirmation inside a Vercel serverless function risks a timeout
    // (Base blocks every ~2 s but slot inclusion can take 5–15 s under load).
    // The TX hash is recorded immediately; on-chain finality is eventual.
    if (platformFeeTzs > 0 && ethers.isAddress(PLATFORM_TREASURY_ADDRESS)) {
      try {
        const feeAmountWei = BigInt(platformFeeTzs) * BigInt(10) ** BigInt(18)
        const feeTx = await token.mint(PLATFORM_TREASURY_ADDRESS, feeAmountWei)
        await db
          .update(burnRequests)
          .set({
            feeTxHash: feeTx.hash,
            feeRecipientAddress: PLATFORM_TREASURY_ADDRESS,
            updatedAt: new Date(),
          })
          .where(eq(burnRequests.id, burnRequestId))
      } catch (feeErr) {
        // Fee-mint failure must not block the withdrawal — log and continue
        const feeErrMsg = feeErr instanceof Error ? feeErr.message : String(feeErr)
        console.error('[withdraw] fee mint failed (non-fatal)', { burnRequestId, error: feeErrMsg })
        await writeAuditLog('burn.fee_mint_failed', 'burn_request', burnRequestId, { platformFeeTzs, treasury: PLATFORM_TREASURY_ADDRESS, error: feeErrMsg }, dbUser.id)
      }
    } else if (platformFeeTzs > 0) {
      console.warn('[withdraw] PLATFORM_TREASURY_ADDRESS not configured — platform fee kept as implicit reserve surplus', { burnRequestId, platformFeeTzs })
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db
      .update(burnRequests)
      .set({ status: 'failed', error: errorMessage, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    console.error('[withdraw] burn failed', { burnRequestId, error: errorMessage })
    return { success: false, error: `Burn failed: ${errorMessage}` }
  }

  // ── Burn confirmed — now trigger Snippe payout ───────────────────────────
  const payoutResult = await sendPayout({
    amountTzs: payoutAmountTzs,
    recipientPhone,
    recipientName: 'nTZS User',
    narration: 'nTZS withdrawal',
    webhookUrl: `${APP_URL}/api/webhooks/snippe/payout`,
    metadata: { burn_request_id: burnRequestId },
  })

  if (payoutResult.success && payoutResult.reference) {
    await db
      .update(burnRequests)
      .set({ payoutReference: payoutResult.reference, payoutStatus: 'pending', updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    await writeAuditLog('burn.payout_initiated', 'burn_request', burnRequestId, { amountTzs: amountTzsTrunc, receiveAmountTzs: receiveAmountTrunc, platformFeeTzs, payoutReference: payoutResult.reference, recipientPhone }, dbUser.id)
  } else {
    const payoutErr = payoutResult.error ?? 'Payout initiation failed'
    await db
      .update(burnRequests)
      .set({ payoutStatus: 'failed', payoutError: payoutErr, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    console.error('[withdraw] payout failed', { burnRequestId, error: payoutErr })
    return { success: false, error: `Payout failed: ${payoutErr}` }
  }

  return { success: true as const, requiresApproval: false }
}
