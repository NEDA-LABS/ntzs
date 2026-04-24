import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import {
  BASE_RPC_URL,
  NTZS_CONTRACT_ADDRESS_BASE,
  BURNER_PRIVATE_KEY,
  MINTER_PRIVATE_KEY,
} from '@/lib/env'
import { sendPayout, sendBankPayout } from '@/lib/psp/snippe'
import { partners, auditLogs } from '@ntzs/db'
import { verifySessionToken } from '@/lib/waas/auth'

const MIN_WITHDRAW_TZS = 5000

const NTZS_WRITE_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
] as const

/**
 * POST /api/v1/partners/treasury/withdraw
 * Initiate a treasury withdrawal to the configured mobile money number via Snippe.
 * Body: { amountTzs: number }
 * Minimum: 5,000 TZS
 */
export async function POST(request: NextRequest) {
  const cookieToken = request.cookies.get('partner_session')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = cookieToken || bearerToken

  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const partnerId = verifySessionToken(token)
  if (!partnerId) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })

  let body: { amountTzs: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { amountTzs } = body

  if (!amountTzs || typeof amountTzs !== 'number') {
    return NextResponse.json({ error: 'amountTzs is required' }, { status: 400 })
  }

  if (amountTzs < MIN_WITHDRAW_TZS) {
    return NextResponse.json(
      { error: `Minimum withdrawal is ${MIN_WITHDRAW_TZS.toLocaleString()} TZS` },
      { status: 400 }
    )
  }

  const { db } = getDb()

  const [partner] = await db
    .select({
      id: partners.id,
      name: partners.name,
      email: partners.email,
      payoutPhone: partners.payoutPhone,
      payoutType: partners.payoutType,
      payoutBankAccount: partners.payoutBankAccount,
      payoutBankName: partners.payoutBankName,
      encryptedHdSeed: partners.encryptedHdSeed,
      treasuryWalletAddress: partners.treasuryWalletAddress,
      webhookUrl: partners.webhookUrl,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }

  const isMobile = partner.payoutType === 'mobile' || !partner.payoutType
  const isBank = partner.payoutType === 'bank'

  if (isMobile && !partner.payoutPhone) {
    return NextResponse.json(
      { error: 'No payout destination configured. Please set your mobile money number or bank account first.' },
      { status: 400 }
    )
  }
  if (isBank && (!partner.payoutBankAccount || !partner.payoutBankName)) {
    return NextResponse.json(
      { error: 'Bank account details are incomplete. Please reconfigure your payout destination.' },
      { status: 400 }
    )
  }
  if (!isMobile && !isBank) {
    return NextResponse.json(
      { error: 'No payout destination configured. Please set your mobile money number or bank account first.' },
      { status: 400 }
    )
  }

  if (!partner.encryptedHdSeed || !partner.treasuryWalletAddress) {
    return NextResponse.json({ error: 'Treasury wallet not provisioned' }, { status: 400 })
  }

  // Verify on-chain treasury balance + acquire signing keys for burn/re-mint.
  const rpcUrl = BASE_RPC_URL
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  if (!BURNER_PRIVATE_KEY) {
    console.error('[treasury/withdraw] BURNER_PRIVATE_KEY is not configured')
    return NextResponse.json({ error: 'Treasury withdrawal temporarily unavailable' }, { status: 503 })
  }
  // MINTER_PRIVATE_KEY is required to roll back the burn if payout fails.
  if (!MINTER_PRIVATE_KEY) {
    console.error('[treasury/withdraw] MINTER_PRIVATE_KEY is not configured — refusing to burn without rollback capability')
    return NextResponse.json({ error: 'Treasury withdrawal temporarily unavailable' }, { status: 503 })
  }

  const amountWei = BigInt(Math.trunc(amountTzs)) * (BigInt(10) ** BigInt(18))

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const burnerSigner = new ethers.Wallet(BURNER_PRIVATE_KEY, provider)
  const tokenAsBurner = new ethers.Contract(contractAddress, NTZS_WRITE_ABI, burnerSigner)

  // 1) Verify balance.
  try {
    const balanceWei: bigint = await tokenAsBurner.balanceOf(partner.treasuryWalletAddress)
    if (balanceWei < amountWei) {
      const balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))
      return NextResponse.json(
        { error: `Insufficient treasury balance. Available: ${balanceTzs.toLocaleString()} TZS` },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[treasury/withdraw] Balance check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to verify treasury balance' }, { status: 500 })
  }

  // 2) Burn the treasury's nTZS on-chain BEFORE initiating fiat payout, so
  //    the partner cannot withdraw fiat while retaining the underlying
  //    tokens. If the fiat payout fails we re-mint in step 4.
  let burnTxHash: string
  try {
    const burnTx = await tokenAsBurner.burn(partner.treasuryWalletAddress, amountWei)
    burnTxHash = burnTx.hash
    await burnTx.wait(1)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[treasury/withdraw] Burn failed:', message)
    await db.insert(auditLogs).values({
      action: 'treasury_withdraw_burn_failed',
      entityType: 'partner',
      entityId: partner.id,
      metadata: { amountTzs, error: message },
    })
    return NextResponse.json({ error: 'Failed to debit treasury' }, { status: 500 })
  }

  await db.insert(auditLogs).values({
    action: 'treasury_withdraw_burned',
    entityType: 'partner',
    entityId: partner.id,
    metadata: { amountTzs, burnTxHash, treasuryWallet: partner.treasuryWalletAddress },
  })

  // 3) Initiate fiat payout.
  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  const webhookUrl = partner.webhookUrl || `${baseUrl}/api/v1/webhooks/snippe`
  const sharedMeta = {
    partnerId: partner.id,
    partnerName: partner.name,
    type: 'treasury_withdrawal',
    burnTxHash,
    amountTzs,
    treasuryWallet: partner.treasuryWalletAddress,
  }

  let result: Awaited<ReturnType<typeof sendPayout>>
  let successMessage: string

  try {
    if (isBank) {
      result = await sendBankPayout({
        amountTzs,
        recipientName: partner.name,
        bankAccount: partner.payoutBankAccount!,
        bankName: partner.payoutBankName!,
        narration: `nTZS treasury withdrawal - ${partner.name}`,
        webhookUrl,
        metadata: sharedMeta,
      })
      successMessage = `Withdrawal of ${amountTzs.toLocaleString()} TZS initiated to ${partner.payoutBankName} account ending ${partner.payoutBankAccount!.slice(-4)}. Funds will arrive within 1-2 business days.`
    } else {
      result = await sendPayout({
        amountTzs,
        recipientPhone: partner.payoutPhone!,
        recipientName: partner.name,
        narration: `nTZS treasury withdrawal - ${partner.name}`,
        webhookUrl,
        metadata: sharedMeta,
      })
      successMessage = `Withdrawal of ${amountTzs.toLocaleString()} TZS initiated to ${partner.payoutPhone}. You will receive an M-Pesa prompt shortly.`
    }
  } catch (err) {
    // Treat a thrown PSP error identically to a failed result — re-mint below.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[treasury/withdraw] PSP call threw:', message)
    result = { success: false, error: message } as Awaited<ReturnType<typeof sendPayout>>
    successMessage = ''
  }

  // 4) On payout-initiation failure, re-mint the burned amount back to the
  //    treasury so the partner is made whole. If re-mint also fails, log
  //    loudly — an operator MUST manually reconcile.
  if (!result.success) {
    try {
      const minterSigner = new ethers.Wallet(MINTER_PRIVATE_KEY, provider)
      const tokenAsMinter = new ethers.Contract(contractAddress, NTZS_WRITE_ABI, minterSigner)
      const remintTx = await tokenAsMinter.mint(partner.treasuryWalletAddress, amountWei)
      await remintTx.wait(1)
      await db.insert(auditLogs).values({
        action: 'treasury_withdraw_reverted',
        entityType: 'partner',
        entityId: partner.id,
        metadata: {
          amountTzs,
          burnTxHash,
          remintTxHash: remintTx.hash,
          payoutError: result.error,
        },
      })
    } catch (remintErr) {
      const message = remintErr instanceof Error ? remintErr.message : String(remintErr)
      console.error('[treasury/withdraw] CRITICAL: remint after payout failure failed — manual reconciliation required', {
        partnerId: partner.id,
        amountTzs,
        burnTxHash,
        payoutError: result.error,
        remintError: message,
      })
      await db.insert(auditLogs).values({
        action: 'treasury_withdraw_reconcile_required',
        entityType: 'partner',
        entityId: partner.id,
        metadata: {
          amountTzs,
          burnTxHash,
          payoutError: result.error,
          remintError: message,
        },
      })
    }

    return NextResponse.json(
      { error: result.error || 'Payout initiation failed' },
      { status: 502 }
    )
  }

  await db.insert(auditLogs).values({
    action: 'treasury_withdraw_initiated',
    entityType: 'partner',
    entityId: partner.id,
    metadata: {
      amountTzs,
      burnTxHash,
      payoutReference: result.reference,
      payoutExternalReference: result.externalReference,
    },
  })

  return NextResponse.json({
    reference: result.reference,
    externalReference: result.externalReference,
    amountTzs,
    fees: result.fees,
    total: result.total,
    burnTxHash,
    message: successMessage,
  })
}
