import { ethers } from 'ethers'
import { eq, and, or, inArray, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, BURNER_PRIVATE_KEY, PLATFORM_TREASURY_ADDRESS, RAMP_NEDA_FEE_BPS } from '@/lib/env'
import { rampSettlements, burnRequests, users, wallets, partners, lpAccounts, lpFills } from '@ntzs/db'
import { executeSwap, calcMinOutput, selectLPForSwap, SWAP_TOKENS, type LPConfig } from '@/lib/fx/swap'
import {
  isMobilePspConfigured, normalizePhone, sendPayout, checkPayoutStatus, lookupRecipientName,
  ACTIVE_PSP_PAYOUT_WEBHOOK_PATH,
} from '@/lib/psp'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'
import { queuePartnerWebhook } from '@/lib/waas/partner-webhooks'
import { getSettlementSigner } from '@/lib/ramp/wallet'
import { PSP_FLAT_FEE_TZS } from '@/lib/ramp/quote'

const APP_URL = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''
const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

async function setStatus(settlementId: string, patch: Record<string, unknown>) {
  const { db } = getDb()
  await db.update(rampSettlements).set({ ...patch, updatedAt: new Date() }).where(eq(rampSettlements.id, settlementId))
}

/** Synthetic platform user + wallet for a settlement address, to satisfy burn_requests FKs. */
async function resolveRampUserWallet(settlementAddress: string): Promise<{ userId: string; walletId: string } | null> {
  const { db } = getDb()
  const neonId = `ramp_${settlementAddress.toLowerCase()}`

  let [u] = await db.select({ id: users.id }).from(users).where(eq(users.neonAuthUserId, neonId)).limit(1)
  if (!u) {
    const [created] = await db.insert(users).values({ neonAuthUserId: neonId, email: `ramp+${settlementAddress.toLowerCase()}@nedapay.internal`, role: 'end_user' }).onConflictDoNothing().returning({ id: users.id })
    u = created ?? (await db.select({ id: users.id }).from(users).where(eq(users.neonAuthUserId, neonId)).limit(1))[0]
  }
  if (!u) return null

  let [w] = await db.select({ id: wallets.id }).from(wallets).where(and(eq(wallets.userId, u.id), eq(wallets.chain, 'base'))).limit(1)
  if (!w) {
    const [created] = await db.insert(wallets).values({ userId: u.id, chain: 'base', address: settlementAddress, provider: 'external' }).onConflictDoNothing().returning({ id: wallets.id })
    w = created ?? (await db.select({ id: wallets.id }).from(wallets).where(and(eq(wallets.userId, u.id), eq(wallets.chain, 'base'))).limit(1))[0]
  }
  if (!w) return null
  return { userId: u.id, walletId: w.id }
}

async function pickLpId(): Promise<string | null> {
  const { db } = getDb()
  const active = await db.select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps }).from(lpAccounts).where(eq(lpAccounts.isActive, true))
  if (active.length === 0) return null
  const configs: LPConfig[] = active.map((l) => ({ id: l.id, bidBps: l.bidBps ?? 120, askBps: l.askBps ?? 150 }))
  const lastRows = await db.select({ lpId: lpFills.lpId, lastAt: sql<Date>`max(${lpFills.createdAt})` }).from(lpFills).where(inArray(lpFills.lpId, configs.map((c) => c.id))).groupBy(lpFills.lpId)
  const last = new Map<string, number>(lastRows.map((r) => [r.lpId, r.lastAt ? new Date(r.lastAt).getTime() : 0]))
  return selectLPForSwap(configs, 'STABLE_TO_NTZS', last).id
}

/**
 * Run an off-ramp settlement: swap the partner's USDC → nTZS, burn it, and pay
 * the recipient via mobile money. Mirrors the proven inline burn+payout+revert
 * flow from /api/v1/withdrawals, but wallet-less (sourced from the partner's
 * settlement float) and tracked on the ramp_settlements row.
 */
export async function runOfframpSettlement(args: {
  partnerId: string
  settlementId: string
  settlementAddress: string
  settlementWalletIndex: number
  encryptedHdSeed: string
  usdcAmount: number
  recipientTzs: number
  feeTzs: number
  recipientPhone: string
}): Promise<{ ok: boolean; status: string; error?: string }> {
  const { db } = getDb()
  const { settlementId, settlementAddress, recipientPhone } = args

  const rpcUrl = BASE_RPC_URL
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
  const solverPrivateKey = process.env.SOLVER_PRIVATE_KEY as `0x${string}` | undefined
  const solverAddress = (process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646') as `0x${string}`
  const burnerKey = BURNER_PRIVATE_KEY || MINTER_PRIVATE_KEY

  if (!rpcUrl || !contractAddress || !solverPrivateKey || !burnerKey) {
    await setStatus(settlementId, { status: 'failed', error: 'Ramp executor not configured' })
    return { ok: false, status: 'failed', error: 'Ramp executor not configured' }
  }

  const grossTzs = args.recipientTzs + args.feeTzs       // nTZS we expect from the swap
  const totalPlatformFeeTzs = args.feeTzs - PSP_FLAT_FEE_TZS  // the 0.5% the customer already pays

  // ── Verify settlement float holds enough USDC ──────────────────────────────
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const usdc = new ethers.Contract(SWAP_TOKENS.USDC.address, ['function balanceOf(address) view returns (uint256)'], provider)
  const usdcBal: bigint = await usdc.balanceOf(settlementAddress)
  const neededUsdc = ethers.parseUnits(args.usdcAmount.toString(), SWAP_TOKENS.USDC.decimals)
  if (usdcBal < neededUsdc) {
    await setStatus(settlementId, { status: 'failed', error: 'Insufficient USDC float' })
    return { ok: false, status: 'failed', error: 'Insufficient USDC float — fund the settlement address first' }
  }

  const lpId = await pickLpId()
  if (!lpId) {
    await setStatus(settlementId, { status: 'failed', error: 'No active LP for conversion' })
    return { ok: false, status: 'failed', error: 'No active liquidity provider available' }
  }

  // ── Leg 1: swap USDC → nTZS from the settlement wallet back to itself ───────
  await setStatus(settlementId, { status: 'swapping' })
  const signer = getSettlementSigner(args.encryptedHdSeed, args.settlementWalletIndex)
  let swapInTxHash: string | undefined
  let swapOutTxHash: string | undefined
  try {
    for await (const u of executeSwap({
      userPrivateKey: signer.privateKey as `0x${string}`,
      solverPrivateKey,
      solverAddress,
      selectedLpId: lpId,
      fromToken: 'USDC',
      toToken: 'NTZS',
      amount: args.usdcAmount,
      minOutput: grossTzs,
      recipientAddress: settlementAddress as `0x${string}`,
      rpcUrl,
    })) {
      if (u.txHash && !swapInTxHash) swapInTxHash = u.txHash
      if (u.status === 'FILLED') swapOutTxHash = u.txHash ?? swapOutTxHash
      if (u.status === 'FAILED' || u.status === 'PARTIAL_FILL_EXHAUSTED') {
        await setStatus(settlementId, { status: 'failed', error: u.message ?? 'Swap failed', swapInTxHash })
        return { ok: false, status: 'failed', error: u.message ?? 'USDC→nTZS swap failed' }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Swap error'
    await setStatus(settlementId, { status: 'failed', error: msg, swapInTxHash })
    return { ok: false, status: 'failed', error: msg }
  }
  await setStatus(settlementId, { swapInTxHash, swapOutTxHash, status: 'paying_out' })

  // ── Leg 2: burn nTZS from the settlement wallet + pay out fiat ──────────────
  const fk = await resolveRampUserWallet(settlementAddress)
  if (!fk) {
    await setStatus(settlementId, { status: 'failed', error: 'Could not resolve settlement bookkeeping user' })
    return { ok: false, status: 'failed', error: 'Internal: bookkeeping user' }
  }

  const [partnerRow] = await db.select({ treasuryWalletAddress: partners.treasuryWalletAddress }).from(partners).where(eq(partners.id, args.partnerId)).limit(1)
  const partnerRecipient = ethers.isAddress(partnerRow?.treasuryWalletAddress ?? '') ? partnerRow!.treasuryWalletAddress! : null
  const nedaRecipient = ethers.isAddress(PLATFORM_TREASURY_ADDRESS) ? PLATFORM_TREASURY_ADDRESS : null

  // Split the platform fee: NEDA takes RAMP_NEDA_FEE_BPS of gross (capped at the
  // total), the partner keeps the rest. The customer already paid totalPlatformFeeTzs
  // either way — this only routes it. With no partner treasury (or no NEDA treasury),
  // the whole fee goes to the one configured recipient (prior fallback behaviour).
  let nedaFeeTzs = nedaRecipient ? Math.min(totalPlatformFeeTzs, Math.round(grossTzs * RAMP_NEDA_FEE_BPS / 10000)) : 0
  let partnerFeeTzs = partnerRecipient ? totalPlatformFeeTzs - nedaFeeTzs : 0
  if (!partnerRecipient && nedaRecipient) nedaFeeTzs = totalPlatformFeeTzs
  if (!nedaRecipient && partnerRecipient) partnerFeeTzs = totalPlatformFeeTzs

  const [burn] = await db.insert(burnRequests).values({
    userId: fk.userId,
    walletId: fk.walletId,
    chain: 'base',
    contractAddress,
    amountTzs: grossTzs,
    reason: 'ramp_offramp',
    status: 'burn_submitted',
    requestedByUserId: fk.userId,
    recipientPhone,
    platformFeeTzs: partnerFeeTzs,
    nedaFeeTzs,
    burnFromAddress: settlementAddress,
    rampSettlementId: settlementId,
  }).returning({ id: burnRequests.id })
  const burnRequestId = burn!.id
  await setStatus(settlementId, { burnRequestId })

  // Burn on-chain from the settlement wallet.
  let feeMinted = false       // partner-share mint occurred
  let nedaFeeMinted = false   // NEDA-share mint occurred
  try {
    const burnSigner = new ethers.Wallet(burnerKey, provider)
    const token = new ethers.Contract(contractAddress, NTZS_BURN_ABI, burnSigner)
    const burnerRole: string = await token.BURNER_ROLE()
    if (!(await token.hasRole(burnerRole, await burnSigner.getAddress()))) {
      throw new Error('Burn key lacks BURNER_ROLE')
    }
    const amountWei = BigInt(String(grossTzs)) * BigInt(10) ** BigInt(18)
    const tx = await token.burn(settlementAddress, amountWei)
    await db.update(burnRequests).set({ txHash: tx.hash, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    await tx.wait(1)
    await db.update(burnRequests).set({ status: 'burned', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))

    // Partner's share of the platform fee.
    if (partnerFeeTzs > 0 && partnerRecipient) {
      try {
        const feeTx = await token.mint(partnerRecipient, BigInt(partnerFeeTzs) * BigInt(10) ** BigInt(18))
        await feeTx.wait(1)
        feeMinted = true
        await db.update(burnRequests).set({ feeTxHash: feeTx.hash, feeRecipientAddress: partnerRecipient, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
      } catch (feeErr) {
        console.error('[ramp/offramp] partner fee mint failed (non-fatal):', feeErr instanceof Error ? feeErr.message : feeErr)
      }
    }

    // NEDA's protocol cut of the corridor.
    if (nedaFeeTzs > 0 && nedaRecipient) {
      try {
        const nedaTx = await token.mint(nedaRecipient, BigInt(nedaFeeTzs) * BigInt(10) ** BigInt(18))
        await nedaTx.wait(1)
        nedaFeeMinted = true
        await db.update(burnRequests).set({ nedaFeeTxHash: nedaTx.hash, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
      } catch (feeErr) {
        console.error('[ramp/offramp] NEDA fee mint failed (non-fatal):', feeErr instanceof Error ? feeErr.message : feeErr)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.update(burnRequests).set({ status: 'failed', error: msg, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    await setStatus(settlementId, { status: 'failed', error: `Burn failed: ${msg}` })
    return { ok: false, status: 'failed', error: msg }
  }

  // Revert helper (same double-revert guard as withdrawals).
  const claimRevert = async (): Promise<boolean> => {
    const updated = await db.update(burnRequests).set({ payoutStatus: 'reverting', updatedAt: new Date() })
      .where(and(eq(burnRequests.id, burnRequestId), or(eq(burnRequests.payoutStatus, 'pending'), eq(burnRequests.payoutStatus, 'failed'))))
      .returning({ id: burnRequests.id })
    return updated.length > 0
  }
  const doRevert = async (reason: string) => {
    if (!(await claimRevert())) return
    const res = await revertOffRampBurn({
      burnRequestId, userAddress: settlementAddress, burnAmountTzs: grossTzs,
      platformFeeTzs: partnerFeeTzs, feeRecipientAddress: partnerRecipient, feeMintOccurred: feeMinted,
      nedaFeeTzs, nedaFeeRecipientAddress: nedaRecipient, nedaFeeMintOccurred: nedaFeeMinted,
      reason,
    })
    await db.update(burnRequests).set({
      status: 'failed', payoutStatus: res.error ? 'reconcile_required' : 'reverted',
      payoutError: res.error ? `${reason} | remint_error: ${res.error}` : reason, updatedAt: new Date(),
    }).where(eq(burnRequests.id, burnRequestId))
    await setStatus(settlementId, { status: 'reverted', error: reason })
    await queuePartnerWebhook(args.partnerId, 'ramp.settlement.failed', { settlementId, reason, returnedAsNtzsTo: settlementAddress })
  }

  // ── Payout ─────────────────────────────────────────────────────────────────
  if (!isMobilePspConfigured()) {
    await setStatus(settlementId, { status: 'failed', error: 'PSP not configured' })
    return { ok: false, status: 'failed', error: 'PSP not configured' }
  }
  const phone = normalizePhone(recipientPhone)
  const webhookUrl = `${APP_URL}${ACTIVE_PSP_PAYOUT_WEBHOOK_PATH}`
  const recipientInfo = await lookupRecipientName(phone).catch(() => ({ name: undefined as string | undefined }))

  try {
    const payout = await sendPayout({
      amountTzs: args.recipientTzs,
      recipientPhone: phone,
      recipientName: recipientInfo.name || 'nTZS Recipient',
      narration: 'nTZS settlement',
      webhookUrl,
      metadata: { burn_request_id: burnRequestId, ramp_settlement_id: settlementId },
    })

    if (payout.success && payout.reference) {
      const ref = payout.reference
      await db.update(burnRequests).set({ payoutReference: ref, payoutStatus: 'pending', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
      await setStatus(settlementId, { pspReference: ref })

      // Poll for quick completion; the signed webhook is the primary path.
      for (const delay of [3000, 6000, 12000]) {
        await new Promise((r) => setTimeout(r, delay))
        try {
          const ps = await checkPayoutStatus(ref)
          if (ps.status === 'completed') {
            await db.update(burnRequests).set({ payoutStatus: 'completed', status: 'burned', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
            await setStatus(settlementId, { status: 'completed' })
            await queuePartnerWebhook(args.partnerId, 'ramp.settlement.completed', { settlementId, tzsAmount: args.recipientTzs, recipientPhone: phone, pspReference: ref })
            return { ok: true, status: 'completed' }
          }
          if (ps.status === 'failed' || ps.status === 'reversed') {
            await doRevert(ps.failureReason || 'Payout failed')
            return { ok: false, status: 'reverted', error: ps.failureReason || 'Payout failed' }
          }
        } catch { /* keep polling */ }
      }
      // Not yet resolved — webhook will finalize.
      return { ok: true, status: 'paying_out' }
    }

    // Ambiguous initiation failure — never auto-revert; flag for reconciliation.
    const reason = payout.error ?? 'Payout initiation failed'
    await db.update(burnRequests).set({ payoutStatus: 'reconcile_required', payoutError: reason, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    await setStatus(settlementId, { status: 'failed', error: `reconcile_required: ${reason}` })
    return { ok: false, status: 'failed', error: reason }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.update(burnRequests).set({ payoutStatus: 'reconcile_required', payoutError: msg, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    await setStatus(settlementId, { status: 'failed', error: `reconcile_required: ${msg}` })
    return { ok: false, status: 'failed', error: msg }
  }
}
