import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { signAndSendTransfer, deriveTreasuryWallet } from '@/lib/waas/hd-wallets'
import { wallets, partnerUsers, transfers, auditLogs, partners } from '@ntzs/db'

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
      {
        error: 'missing_required_fields',
        message: 'fromUserId, toUserId, and amountTzs are required',
        details: { fromUserId: !!fromUserId, toUserId: !!toUserId, amountTzs: !!amountTzs }
      },
      { status: 400 }
    )
  }

  if (amountTzs <= 0) {
    return NextResponse.json(
      {
        error: 'invalid_amount',
        message: 'amountTzs must be positive',
        details: { amountTzs }
      },
      { status: 400 }
    )
  }

  if (fromUserId === toUserId) {
    return NextResponse.json(
      {
        error: 'invalid_transfer',
        message: 'Cannot transfer to self',
        details: { fromUserId, toUserId }
      },
      { status: 400 }
    )
  }

  const { db } = getDb()

  // Fetch partner fee config and treasury wallet
  const [partnerRow] = await db
    .select({
      feePercent: partners.feePercent,
      treasuryWalletAddress: partners.treasuryWalletAddress,
      encryptedHdSeed: partners.encryptedHdSeed,
    })
    .from(partners)
    .where(eq(partners.id, partner.id))
    .limit(1)

  const feePercent = partnerRow ? parseFloat(String(partnerRow.feePercent ?? '0')) : 0
  const treasuryWalletAddress = partnerRow?.treasuryWalletAddress ?? null

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
    return NextResponse.json(
      {
        error: 'user_not_found',
        message: 'Sender user not found',
        details: { userId: fromUserId, role: 'sender' }
      },
      { status: 404 }
    )
  }
  if (!toMapping) {
    return NextResponse.json(
      {
        error: 'user_not_found',
        message: 'Recipient user not found',
        details: { userId: toUserId, role: 'recipient' }
      },
      { status: 404 }
    )
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
    return NextResponse.json(
      {
        error: 'wallet_not_provisioned',
        message: 'Sender wallet is not provisioned yet',
        details: { userId: fromUserId, role: 'sender' }
      },
      { status: 400 }
    )
  }
  if (!toWallet || toWallet.address.startsWith('0x_pending_')) {
    return NextResponse.json(
      {
        error: 'wallet_not_provisioned',
        message: 'Recipient wallet is not provisioned yet',
        details: { userId: toUserId, role: 'recipient' }
      },
      { status: 400 }
    )
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
    return NextResponse.json(
      {
        error: 'database_error',
        message: 'Failed to create transfer record'
      },
      { status: 500 }
    )
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
    return NextResponse.json(
      {
        error: 'configuration_error',
        message: 'Blockchain configuration missing. Contact support.'
      },
      { status: 500 }
    )
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)

    // Calculate fee split
    const feeAmountTzs = feePercent > 0 ? Math.floor(amountTzs * feePercent / 100) : 0
    const recipientAmountTzs = amountTzs - feeAmountTzs
    const recipientAmountWei = BigInt(recipientAmountTzs) * BigInt(10) ** BigInt(18)
    const feeAmountWei = BigInt(feeAmountTzs) * BigInt(10) ** BigInt(18)
    const totalAmountWei = BigInt(String(amountTzs)) * BigInt(10) ** BigInt(18)

    // Check sender balance first
    const token = new ethers.Contract(contractAddress, NTZS_TRANSFER_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(fromWallet.address)

    if (balanceWei < totalAmountWei) {
      const balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))
      await db
        .update(transfers)
        .set({ status: 'failed', error: 'Insufficient balance', updatedAt: new Date() })
        .where(eq(transfers.id, transfer.id))

      return NextResponse.json(
        {
          error: 'insufficient_balance',
          message: 'Sender has insufficient nTZS balance',
          details: {
            available: balanceTzs,
            requested: amountTzs,
            shortfall: amountTzs - balanceTzs
          }
        },
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

    // Check sender has enough ETH for gas
    const senderEthBalance = await provider.getBalance(fromWallet.address)
    if (senderEthBalance === BigInt(0)) {
      await db
        .update(transfers)
        .set({ status: 'failed', error: 'Sender wallet has no ETH for gas', updatedAt: new Date() })
        .where(eq(transfers.id, transfer.id))
      return NextResponse.json(
        {
          error: 'insufficient_gas',
          message: 'Sender wallet has no ETH for gas fees',
          details: {
            walletAddress: fromWallet.address,
            ethBalance: '0',
            solution: 'Wallet needs to be funded with ETH for gas. Contact support for gas funding.'
          }
        },
        { status: 400 }
      )
    }

    // Sign and send the main transfer (recipient amount after fee)
    const { txHash } = await signAndSendTransfer({
      encryptedSeed: partner.encryptedHdSeed,
      walletIndex: fromMapping.walletIndex,
      contractAddress,
      toAddress: toWallet.address,
      amountWei: recipientAmountWei,
      rpcUrl,
    })

    // If partner has a fee and a treasury wallet, send the fee split
    let feeTxHash: string | null = null
    if (feeAmountTzs > 0 && treasuryWalletAddress && partnerRow?.encryptedHdSeed) {
      try {
        const feeTransfer = await signAndSendTransfer({
          encryptedSeed: partnerRow.encryptedHdSeed,
          walletIndex: fromMapping.walletIndex,
          contractAddress,
          toAddress: treasuryWalletAddress,
          amountWei: feeAmountWei,
          rpcUrl,
        })
        feeTxHash = feeTransfer.txHash
      } catch (feeErr) {
        console.error('[v1/transfers] Fee split failed (non-fatal):', feeErr instanceof Error ? feeErr.message : feeErr)
      }
    }

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
        recipientAmountTzs,
        feeAmountTzs,
        feePercent,
        fromWallet: fromWallet.address,
        toWallet: toWallet.address,
        txHash,
        feeTxHash,
        partnerId: partner.id,
      },
    })

    return NextResponse.json(
      {
        id: transfer.id,
        status: 'completed',
        txHash,
        amountTzs,
        recipientAmountTzs,
        feeAmountTzs,
        feeTxHash,
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

    // Categorize blockchain errors
    const isGasError =
      errorMessage.includes('INSUFFICIENT_FUNDS') ||
      errorMessage.includes('insufficient funds') ||
      errorMessage.includes('intrinsic transaction cost')

    const isNetworkError =
      errorMessage.includes('network') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('connection')

    const isContractError =
      errorMessage.includes('revert') ||
      errorMessage.includes('execution reverted')

    let errorCode = 'blockchain_error'
    let userMessage = 'Transfer failed due to blockchain error'
    let solution = 'Please try again or contact support'

    if (isGasError) {
      errorCode = 'insufficient_gas'
      userMessage = 'Insufficient ETH for gas fees'
      solution = 'Wallet needs ETH funding. Contact support for gas funding.'
    } else if (isNetworkError) {
      errorCode = 'network_error'
      userMessage = 'Blockchain network connection failed'
      solution = 'Please try again in a few moments'
    } else if (isContractError) {
      errorCode = 'contract_error'
      userMessage = 'Smart contract execution failed'
      solution = 'Transaction was rejected by the contract. Contact support.'
    }

    return NextResponse.json(
      {
        error: errorCode,
        message: userMessage,
        details: {
          transferId: transfer.id,
          technicalError: errorMessage,
          solution
        }
      },
      { status: 500 }
    )
  }
}
