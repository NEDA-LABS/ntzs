import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL as ENV_BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE as ENV_CONTRACT_ADDRESS } from '@/lib/env'
import { authenticatePartner } from '@/lib/waas/auth'
import { signAndSendTransfer, fundWalletWithGas } from '@/lib/waas/hd-wallets'
import { sendTransaction as sendCdpTransaction } from '@/lib/waas/cdp-server'
import { wallets, partnerUsers, transfers, auditLogs, partners, users } from '@ntzs/db'

const TRANSFER_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const

// Base USDC (6 decimals)
const USDC_CONTRACT_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_DECIMALS = 6
const NTZS_DECIMALS = 18

type TransferToken = 'ntzs' | 'usdc'

function resolveToken(raw: unknown): TransferToken | { error: string } {
  if (raw == null) return 'ntzs'
  if (typeof raw !== 'string') return { error: 'token must be a string' }
  const norm = raw.toLowerCase()
  if (norm === 'ntzs' || norm === 'usdc') return norm
  return { error: `Unsupported token "${raw}" — must be NTZS or USDC` }
}

/**
 * POST /api/v1/transfers — Transfer nTZS or USDC between two users / to an address
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult

  let body: {
    fromUserId: string
    toUserId?: string
    toAddress?: string
    token?: string
    amount?: number | string
    amountTzs?: number | string
    metadata?: Record<string, unknown>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { fromUserId, toUserId, toAddress, metadata } = body

  // Resolve token (default: nTZS for backward compat)
  const tokenResult = resolveToken(body.token)
  if (typeof tokenResult !== 'string') {
    return NextResponse.json(
      { error: 'invalid_token', message: tokenResult.error, details: { token: body.token } },
      { status: 400 }
    )
  }
  const token: TransferToken = tokenResult
  const decimals = token === 'usdc' ? USDC_DECIMALS : NTZS_DECIMALS
  const tokenContractAddress = token === 'usdc' ? USDC_CONTRACT_BASE : ENV_CONTRACT_ADDRESS

  // Accept `amount` (new, token-agnostic) or fall back to `amountTzs` (legacy)
  const rawAmount = body.amount ?? body.amountTzs
  const amountNum = typeof rawAmount === 'string' ? parseFloat(rawAmount) : rawAmount

  if (!fromUserId || amountNum == null || !Number.isFinite(amountNum)) {
    return NextResponse.json(
      {
        error: 'missing_required_fields',
        message: 'fromUserId and amount (or amountTzs) are required',
        details: { fromUserId: !!fromUserId, amount: rawAmount ?? null }
      },
      { status: 400 }
    )
  }

  if (!toUserId && !toAddress) {
    return NextResponse.json(
      {
        error: 'missing_required_fields',
        message: 'Either toUserId or toAddress is required',
        details: { toUserId: !!toUserId, toAddress: !!toAddress }
      },
      { status: 400 }
    )
  }

  if (toUserId && toAddress) {
    return NextResponse.json(
      {
        error: 'invalid_transfer',
        message: 'Provide either toUserId or toAddress, not both',
      },
      { status: 400 }
    )
  }

  if (toAddress && !ethers.isAddress(toAddress)) {
    return NextResponse.json(
      {
        error: 'invalid_address',
        message: 'toAddress is not a valid Ethereum address',
        details: { toAddress }
      },
      { status: 400 }
    )
  }

  if (amountNum <= 0) {
    return NextResponse.json(
      {
        error: 'invalid_amount',
        message: 'amount must be positive',
        details: { amount: amountNum, token }
      },
      { status: 400 }
    )
  }

  // Parse to base-units — validates decimal precision matches the token
  let totalAmountWei: bigint
  try {
    totalAmountWei = ethers.parseUnits(amountNum.toString(), decimals)
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_amount',
        message: `Amount has too many decimals for ${token.toUpperCase()} (max ${decimals})`,
        details: { amount: amountNum, token, decimals, reason: err instanceof Error ? err.message : String(err) }
      },
      { status: 400 }
    )
  }

  if (toUserId && fromUserId === toUserId) {
    return NextResponse.json(
      {
        error: 'invalid_transfer',
        message: 'Cannot transfer to self',
        details: { fromUserId, toUserId }
      },
      { status: 400 }
    )
  }

  // Determine if this is a send-to-address transfer
  const isAddressTransfer = !!toAddress && !toUserId

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

  // Verify sender belongs to this partner and get wallet index
  const [fromMapping] = await db
    .select({ userId: partnerUsers.userId, walletIndex: partnerUsers.walletIndex })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, fromUserId)))
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

  // For user-to-user transfers, verify the recipient too
  if (!isAddressTransfer) {
    const [toMapping] = await db
      .select({ userId: partnerUsers.userId })
      .from(partnerUsers)
      .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, toUserId!)))
      .limit(1)

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
  }

  // Get sender wallet
  const [fromWallet] = await db
    .select({ id: wallets.id, address: wallets.address, provider: wallets.provider })
    .from(wallets)
    .where(and(eq(wallets.userId, fromUserId), eq(wallets.chain, 'base')))
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

  // Resolve destination address
  let destinationAddress: string

  if (isAddressTransfer) {
    destinationAddress = toAddress!
  } else {
    const [toWallet] = await db
      .select({ id: wallets.id, address: wallets.address, provider: wallets.provider })
      .from(wallets)
      .where(and(eq(wallets.userId, toUserId!), eq(wallets.chain, 'base')))
      .limit(1)

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
    destinationAddress = toWallet.address
  }

  if (fromWallet.address.toLowerCase() === destinationAddress.toLowerCase()) {
    return NextResponse.json(
      {
        error: 'invalid_transfer',
        message: 'Cannot transfer to the same wallet address',
        details: { fromAddress: fromWallet.address, toAddress: destinationAddress }
      },
      { status: 400 }
    )
  }

  // Persist transfer amount in the existing amount_tzs column:
  //   - nTZS: whole TZS integer (as before)
  //   - USDC: base-units (µUSDC) — fits in JS number up to ~9 billion USDC
  const storedAmount = token === 'usdc'
    ? Number(totalAmountWei)
    : Math.floor(amountNum)

  // Create transfer record
  const [transfer] = await db
    .insert(transfers)
    .values({
      partnerId: partner.id,
      fromUserId,
      toUserId: toUserId || null,
      toAddress: destinationAddress,
      token,
      amountTzs: storedAmount,
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
  const rpcUrl = ENV_BASE_RPC_URL
  const contractAddress = tokenContractAddress

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

    // Fee split — work in basis points to keep BigInt math exact
    const feeBps = feePercent > 0 ? Math.round(feePercent * 100) : 0
    const feeAmountWei = feeBps > 0 ? (totalAmountWei * BigInt(feeBps)) / BigInt(10000) : BigInt(0)
    const recipientAmountWei = totalAmountWei - feeAmountWei

    const feeAmount = parseFloat(ethers.formatUnits(feeAmountWei, decimals))
    const recipientAmount = parseFloat(ethers.formatUnits(recipientAmountWei, decimals))

    // Check sender balance first
    const erc20 = new ethers.Contract(contractAddress, TRANSFER_ABI, provider)
    const balanceWei: bigint = await erc20.balanceOf(fromWallet.address)

    if (balanceWei < totalAmountWei) {
      const available = parseFloat(ethers.formatUnits(balanceWei, decimals))
      await db
        .update(transfers)
        .set({ status: 'failed', error: 'Insufficient balance', updatedAt: new Date() })
        .where(eq(transfers.id, transfer.id))

      return NextResponse.json(
        {
          error: 'insufficient_balance',
          message: `Sender has insufficient ${token.toUpperCase()} balance`,
          details: {
            token,
            available,
            requested: amountNum,
            shortfall: amountNum - available,
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

    // Determine if sender wallet is CDP or HD-derived
    const isCdpWallet = fromWallet.provider === 'coinbase_embedded'
    let txHash: string

    if (isCdpWallet) {
      // Use CDP signing for coinbase_embedded wallets
      console.log('[v1/transfers] Using CDP signing for wallet:', fromWallet.address)
      
      // Get sender user email for CDP auth
      const [senderUser] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, fromUserId))
        .limit(1)
      
      if (!senderUser) {
        throw new Error('Sender user not found')
      }

      const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)'])
      const cdpResult = await sendCdpTransaction(fromUserId, senderUser.email, {
        destination: contractAddress,
        data: iface.encodeFunctionData('transfer', [destinationAddress, recipientAmountWei]),
      } as any)

      if ('error' in cdpResult) {
        throw new Error(cdpResult.error)
      }
      
      txHash = cdpResult.txHash
    } else {
      // Use HD wallet signing for external wallets
      if (!partner.encryptedHdSeed) {
        throw new Error('Partner HD wallet seed not configured')
      }
      if (fromMapping.walletIndex == null) {
        throw new Error('Sender has no HD wallet index assigned')
      }

      // Ensure sender has enough ETH for gas — top up from relayer if needed
      const MIN_GAS_WEI = ethers.parseEther('0.0001')
      const senderEthBalance = await provider.getBalance(fromWallet.address)
      if (senderEthBalance < MIN_GAS_WEI) {
        console.log(`[v1/transfers] Topping up gas for ${fromWallet.address} (balance: ${ethers.formatEther(senderEthBalance)} ETH)`)
        const rpcUrlForFund = ENV_BASE_RPC_URL || rpcUrl
        const relayerKey = process.env.RELAYER_PRIVATE_KEY || process.env.MINTER_PRIVATE_KEY
        if (!relayerKey) {
          console.error('[v1/transfers] Gas relay failed: RELAYER_PRIVATE_KEY and MINTER_PRIVATE_KEY are both missing from env')
        }
        const funded = await fundWalletWithGas({
          toAddress: fromWallet.address,
          rpcUrl: rpcUrlForFund,
          amountEth: '0.00005',
        })
        if (!funded) {
          const reason = !relayerKey
            ? 'No relayer key configured (RELAYER_PRIVATE_KEY / MINTER_PRIVATE_KEY not set)'
            : 'Relayer wallet has insufficient ETH'
          console.error(`[v1/transfers] Gas relay unavailable for ${fromWallet.address}: ${reason}`)
          await db
            .update(transfers)
            .set({ status: 'failed', error: reason, updatedAt: new Date() })
            .where(eq(transfers.id, transfer.id))
          return NextResponse.json(
            {
              error: 'relayer_unavailable',
              message: 'Gas relay is temporarily unavailable. Please try again shortly or contact support.',
              details: { walletAddress: fromWallet.address }
            },
            { status: 503 }
          )
        }
      }

      // Sign and send the main transfer (recipient amount after fee)
      const hdResult = await signAndSendTransfer({
        encryptedSeed: partner.encryptedHdSeed,
        walletIndex: fromMapping.walletIndex,
        contractAddress,
        toAddress: destinationAddress,
        amountWei: recipientAmountWei,
        rpcUrl,
      })
      
      txHash = hdResult.txHash
    }

    // If partner has a fee and a treasury wallet, send the fee split
    let feeTxHash: string | null = null
    if (feeAmountWei > BigInt(0) && treasuryWalletAddress) {
      try {
        if (isCdpWallet) {
          // Use CDP for fee transfer
          const [senderUser] = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, fromUserId))
            .limit(1)
          
          if (senderUser) {
            const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)'])
            const cdpFeeResult = await sendCdpTransaction(fromUserId, senderUser.email, {
              destination: contractAddress,
              data: iface.encodeFunctionData('transfer', [treasuryWalletAddress, feeAmountWei]),
            } as any)
            
            if ('txHash' in cdpFeeResult) {
              feeTxHash = cdpFeeResult.txHash
            }
          }
        } else if (partnerRow?.encryptedHdSeed && fromMapping.walletIndex != null) {
          // Use HD wallet for fee transfer
          const feeTransfer = await signAndSendTransfer({
            encryptedSeed: partnerRow.encryptedHdSeed,
            walletIndex: fromMapping.walletIndex,
            contractAddress,
            toAddress: treasuryWalletAddress,
            amountWei: feeAmountWei,
            rpcUrl,
          })
          feeTxHash = feeTransfer.txHash
        }
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
        token,
        amount: amountNum,
        recipientAmount,
        feeAmount,
        feePercent,
        fromWallet: fromWallet.address,
        toWallet: destinationAddress,
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
        token,
        amount: amountNum,
        recipientAmount,
        feeAmount,
        feeTxHash,
        toAddress: destinationAddress,
        // Legacy aliases (nTZS-only, for backward compatibility)
        amountTzs: token === 'ntzs' ? amountNum : undefined,
        recipientAmountTzs: token === 'ntzs' ? recipientAmount : undefined,
        feeAmountTzs: token === 'ntzs' ? feeAmount : undefined,
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
