import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { signAndSendTransfer } from '@/lib/waas/hd-wallets'
import { wallets, partnerUsers, transfers, auditLogs } from '@ntzs/db'

const NTZS_TRANSFER_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const

/**
 * POST /api/v1/transfers — Transfer nTZS between two users
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult

  let body: { fromUserId: string; toUserId: string; amountTzs: number; metadata?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { fromUserId, toUserId, amountTzs, metadata } = body

  if (!fromUserId || !toUserId || !amountTzs) {
    return NextResponse.json(
      { error: 'fromUserId, toUserId, and amountTzs are required' },
      { status: 400 }
    )
  }

  if (amountTzs <= 0) {
    return NextResponse.json({ error: 'amountTzs must be positive' }, { status: 400 })
  }

  if (fromUserId === toUserId) {
    return NextResponse.json({ error: 'Cannot transfer to self' }, { status: 400 })
  }

  const { db } = getDb()

  // Verify both users belong to this partner and get wallet indexes
  const [fromMapping] = await db
    .select({ userId: partnerUsers.userId, walletIndex: partnerUsers.walletIndex })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, fromUserId)))
    .limit(1)

  const [toMapping] = await db
    .select({ userId: partnerUsers.userId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, toUserId)))
    .limit(1)

  if (!fromMapping) {
    return NextResponse.json({ error: 'Sender user not found' }, { status: 404 })
  }
  if (!toMapping) {
    return NextResponse.json({ error: 'Recipient user not found' }, { status: 404 })
  }

  // Get wallets
  const [fromWallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, fromUserId), eq(wallets.chain, 'base')))
    .limit(1)

  const [toWallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, toUserId), eq(wallets.chain, 'base')))
    .limit(1)

  if (!fromWallet || fromWallet.address.startsWith('0x_pending_')) {
    return NextResponse.json({ error: 'Sender wallet is not provisioned' }, { status: 400 })
  }
  if (!toWallet || toWallet.address.startsWith('0x_pending_')) {
    return NextResponse.json({ error: 'Recipient wallet is not provisioned' }, { status: 400 })
  }

  // Create transfer record
  const [transfer] = await db
    .insert(transfers)
    .values({
      partnerId: partner.id,
      fromUserId,
      toUserId,
      amountTzs,
      status: 'pending',
      metadata: metadata || null,
    })
    .returning({ id: transfers.id })

  if (!transfer) {
    return NextResponse.json({ error: 'Failed to create transfer record' }, { status: 500 })
  }

  // Execute on-chain transfer
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL
  const contractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    await db
      .update(transfers)
      .set({ status: 'failed', error: 'Blockchain configuration missing', updatedAt: new Date() })
      .where(eq(transfers.id, transfer.id))
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)

    // Check sender balance first
    const token = new ethers.Contract(contractAddress, NTZS_TRANSFER_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(fromWallet.address)
    const amountWei = BigInt(String(amountTzs)) * BigInt(10) ** BigInt(18)

    if (balanceWei < amountWei) {
      const balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))
      await db
        .update(transfers)
        .set({ status: 'failed', error: 'Insufficient balance', updatedAt: new Date() })
        .where(eq(transfers.id, transfer.id))

      return NextResponse.json(
        { error: `Insufficient balance. Available: ${balanceTzs} TZS, requested: ${amountTzs} TZS` },
        { status: 400 }
      )
    }

    // Update status to submitted
    await db
      .update(transfers)
      .set({ status: 'submitted', updatedAt: new Date() })
      .where(eq(transfers.id, transfer.id))

    // Verify partner has HD seed and sender has a wallet index
    if (!partner.encryptedHdSeed) {
      throw new Error('Partner HD wallet seed not configured')
    }
    if (fromMapping.walletIndex == null) {
      throw new Error('Sender has no HD wallet index assigned')
    }

    // Sign and send the ERC-20 transfer using the sender's HD-derived key
    const { txHash } = await signAndSendTransfer({
      encryptedSeed: partner.encryptedHdSeed,
      walletIndex: fromMapping.walletIndex,
      contractAddress,
      toAddress: toWallet.address,
      amountWei,
      rpcUrl,
    })

    await db
      .update(transfers)
      .set({
        status: 'completed',
        txHash,
        updatedAt: new Date(),
      })
      .where(eq(transfers.id, transfer.id))

    await db.insert(auditLogs).values({
      action: 'transfer_completed',
      entityType: 'transfer',
      entityId: transfer.id,
      metadata: {
        fromUserId,
        toUserId,
        amountTzs,
        fromWallet: fromWallet.address,
        toWallet: toWallet.address,
        txHash,
        partnerId: partner.id,
      },
    })

    return NextResponse.json(
      {
        id: transfer.id,
        status: 'completed',
        txHash,
        amountTzs,
      },
      { status: 201 }
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    await db
      .update(transfers)
      .set({ status: 'failed', error: errorMessage, updatedAt: new Date() })
      .where(eq(transfers.id, transfer.id))

    console.error('[v1/transfers] Transfer failed:', errorMessage)

    return NextResponse.json(
      { error: 'Transfer failed: ' + errorMessage },
      { status: 500 }
    )
  }
}
