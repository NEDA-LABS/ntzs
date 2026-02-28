'use server'

import { and, eq } from 'drizzle-orm'
import { ethers } from 'ethers'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { burnRequests, kycCases, wallets } from '@ntzs/db'
import { isValidTanzanianPhone, normalizePhone, sendPayout } from '@/lib/psp/snippe'

const SAFE_BURN_THRESHOLD_TZS = 100000
const PLATFORM_FEE_PERCENT = 0.5
const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''

const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function paused() view returns (bool)',
] as const

export async function createWithdrawRequestAction(formData: FormData) {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const amountTzsRaw = String(formData.get('amountTzs') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()

  const amountTzs = Number(amountTzsRaw)
  if (!Number.isFinite(amountTzs) || amountTzs < 5000) {
    throw new Error('Minimum withdrawal amount is 5,000 TZS')
  }

  if (!phone) {
    throw new Error('Phone number is required for mobile money payout')
  }
  if (!isValidTanzanianPhone(phone)) {
    throw new Error('Invalid Tanzanian mobile number')
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

  const contractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE ?? process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA
  if (!contractAddress) throw new Error('Contract not configured')

  const amountTzsTrunc = Math.trunc(amountTzs)
  const recipientPhone = normalizePhone(phone)

  // Platform fee: 0.5% of withdrawal, minimum 1 TZS, rounded up
  const platformFeeTzs = Math.max(1, Math.ceil(amountTzsTrunc * (PLATFORM_FEE_PERCENT / 100)))
  // Amount user actually receives = full amount minus platform fee
  const payoutAmountTzs = amountTzsTrunc - platformFeeTzs

  // Large amounts require admin approval — queue and exit
  if (amountTzsTrunc >= SAFE_BURN_THRESHOLD_TZS) {
    await db.insert(burnRequests).values({
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
    })
    redirect('/app/user/activity')
  }

  // ── Small amounts: execute burn + payout inline ──────────────────────────

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL
  const privateKey = process.env.MINTER_PRIVATE_KEY
  if (!rpcUrl || !privateKey) throw new Error('Burn executor not configured')

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
    if (!hasBurner) throw new Error('Burn key not configured correctly — contact support')

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
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db
      .update(burnRequests)
      .set({ status: 'failed', error: errorMessage, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    throw new Error(`Burn failed: ${errorMessage}`)
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
  } else {
    await db
      .update(burnRequests)
      .set({ payoutStatus: 'failed', payoutError: payoutResult.error ?? 'Payout initiation failed', updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    throw new Error(`Payout failed: ${payoutResult.error ?? 'Payout initiation failed'}`)
  }

  redirect('/app/user/activity')
}
