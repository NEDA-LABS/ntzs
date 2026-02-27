import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { isValidTanzanianPhone } from '@/lib/psp/snippe'
import { users, wallets, partnerUsers, burnRequests } from '@ntzs/db'

const SAFE_MINT_THRESHOLD_TZS = 100000

const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

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

  const { userId, amountTzs, phoneNumber } = body

  if (!userId || !amountTzs || !phoneNumber) {
    return NextResponse.json(
      { error: 'userId, amountTzs, and phoneNumber are required' },
      { status: 400 }
    )
  }

  if (amountTzs < 1000) {
    return NextResponse.json(
      { error: 'Minimum withdrawal amount is 1,000 TZS' },
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
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL
  const contractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(contractAddress, NTZS_BALANCE_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(wallet.address)
    const balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))

    if (balanceTzs < amountTzs) {
      return NextResponse.json(
        { error: `Insufficient balance. Available: ${balanceTzs} TZS, requested: ${amountTzs} TZS` },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[v1/withdrawals] Balance check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to verify balance' }, { status: 500 })
  }

  // Auto-approve small amounts, require admin approval for large ones
  const autoApprove = amountTzs < SAFE_MINT_THRESHOLD_TZS
  const initialStatus = autoApprove ? 'approved' : 'requested'

  // Create burn request
  const [burn] = await db
    .insert(burnRequests)
    .values({
      userId,
      walletId: wallet.id,
      chain: 'base',
      contractAddress,
      amountTzs,
      reason: 'WaaS withdrawal',
      status: initialStatus,
      requestedByUserId: userId,
      recipientPhone: phoneNumber,
    })
    .returning({
      id: burnRequests.id,
      status: burnRequests.status,
      amountTzs: burnRequests.amountTzs,
    })

  if (!burn) {
    return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
  }

  return NextResponse.json(
    {
      id: burn.id,
      status: burn.status,
      amountTzs: burn.amountTzs,
      ...(autoApprove
        ? { message: 'Withdrawal approved. Burn and payout will be processed shortly.' }
        : { message: 'Withdrawal requires admin approval for amounts >= 9,000 TZS.' }),
    },
    { status: 201 }
  )
}
