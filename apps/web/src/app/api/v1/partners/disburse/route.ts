import crypto from 'crypto'
import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { partners, partnerUsers, partnerSubWallets, wallets, auditLogs } from '@ntzs/db'
import { deriveTreasuryWallet, deriveSubWallet } from '@/lib/waas/hd-wallets'

const NTZS_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const

function verifySessionToken(token: string): string | null {
  const secret = process.env.APP_SECRET || 'dev-secret-do-not-use'
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, sig] = parts
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded!).digest('base64url')

  if (sig!.length !== expectedSig.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig!, 'utf8'), Buffer.from(expectedSig, 'utf8'))) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    if (payload.exp && payload.exp < Date.now()) return null
    return payload.pid || null
  } catch {
    return null
  }
}

/**
 * POST /api/v1/partners/disburse
 * Disburse TZS from the partner's treasury (or a sub-wallet) to a user's wallet.
 * Auth: partner session cookie (dashboard only — not partner API key).
 * Body: { toUserId: string; amountTzs: number; fromSubWalletId?: string }
 */
export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cookieToken = request.cookies.get('partner_session')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = cookieToken || bearerToken

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const partnerId = verifySessionToken(token)
  if (!partnerId) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { toUserId: string; amountTzs: number; fromSubWalletId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { toUserId, amountTzs, fromSubWalletId } = body

  if (!toUserId || !amountTzs) {
    return NextResponse.json({ error: 'toUserId and amountTzs are required' }, { status: 400 })
  }
  if (amountTzs <= 0) {
    return NextResponse.json({ error: 'amountTzs must be positive' }, { status: 400 })
  }

  const { db } = getDb()

  // ── Fetch partner ───────────────────────────────────────────────────────────
  const [partner] = await db
    .select({
      id: partners.id,
      encryptedHdSeed: partners.encryptedHdSeed,
      treasuryWalletAddress: partners.treasuryWalletAddress,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }
  if (!partner.encryptedHdSeed) {
    return NextResponse.json({ error: 'Partner HD wallet not configured' }, { status: 500 })
  }
  if (!partner.treasuryWalletAddress) {
    return NextResponse.json({ error: 'Partner treasury wallet not provisioned' }, { status: 400 })
  }

  // ── Resolve source wallet (treasury or sub-wallet) ──────────────────────────
  let fromAddress: string = partner.treasuryWalletAddress
  let fromWalletIndex: number | null = null
  let fromLabel = 'Treasury'

  if (fromSubWalletId) {
    const [subWallet] = await db
      .select({
        id: partnerSubWallets.id,
        label: partnerSubWallets.label,
        address: partnerSubWallets.address,
        walletIndex: partnerSubWallets.walletIndex,
      })
      .from(partnerSubWallets)
      .where(and(eq(partnerSubWallets.id, fromSubWalletId), eq(partnerSubWallets.partnerId, partnerId)))
      .limit(1)

    if (!subWallet) {
      return NextResponse.json({ error: 'Sub-wallet not found' }, { status: 404 })
    }
    fromAddress = subWallet.address
    fromWalletIndex = subWallet.walletIndex
    fromLabel = subWallet.label
  }

  // ── Verify recipient belongs to this partner ────────────────────────────────
  const [toMapping] = await db
    .select({ userId: partnerUsers.userId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partnerId), eq(partnerUsers.userId, toUserId)))
    .limit(1)

  if (!toMapping) {
    return NextResponse.json({ error: 'Recipient user not found for this partner' }, { status: 404 })
  }

  // ── Get recipient wallet ────────────────────────────────────────────────────
  const [toWallet] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, toUserId), eq(wallets.chain, 'base')))
    .limit(1)

  if (!toWallet || toWallet.address.startsWith('0x_pending_')) {
    return NextResponse.json({ error: 'Recipient wallet is not provisioned' }, { status: 400 })
  }

  // ── On-chain disbursal ──────────────────────────────────────────────────────
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL
  const contractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(contractAddress, NTZS_ABI, provider)

    // Check source TZS balance
    const amountWei = BigInt(amountTzs) * BigInt(10) ** BigInt(18)
    const sourceBalance: bigint = await token.balanceOf(fromAddress)

    if (sourceBalance < amountWei) {
      const balanceTzs = Number(sourceBalance / (BigInt(10) ** BigInt(18)))
      return NextResponse.json(
        {
          error: `Insufficient ${fromLabel} balance. Available: ${balanceTzs} TZS, requested: ${amountTzs} TZS`,
        },
        { status: 400 }
      )
    }

    // Check source has ETH for gas
    const sourceEthBalance = await provider.getBalance(fromAddress)
    if (sourceEthBalance === BigInt(0)) {
      return NextResponse.json(
        { error: `${fromLabel} wallet has no ETH for gas. Please contact support.` },
        { status: 400 }
      )
    }

    // Derive signing wallet (treasury index 0, or sub-wallet at its index)
    const signingWallet = (
      fromWalletIndex !== null
        ? deriveSubWallet(partner.encryptedHdSeed, fromWalletIndex)
        : deriveTreasuryWallet(partner.encryptedHdSeed)
    ).connect(provider)

    const iface = new ethers.Interface([
      'function transfer(address to, uint256 amount) returns (bool)',
    ])

    const tx = await signingWallet.sendTransaction({
      to: contractAddress,
      data: iface.encodeFunctionData('transfer', [toWallet.address, amountWei]),
    })

    const receipt = await tx.wait()
    if (!receipt) throw new Error('Transaction receipt is null')

    // ── Audit log ───────────────────────────────────────────────────────────
    await db.insert(auditLogs).values({
      action: 'treasury_disbursement',
      entityType: 'partner',
      entityId: partnerId,
      metadata: {
        toUserId,
        toWallet: toWallet.address,
        amountTzs,
        txHash: receipt.hash,
        fromWallet: fromAddress,
        fromLabel,
        fromSubWalletId: fromSubWalletId || null,
        partnerId,
      },
    })

    return NextResponse.json(
      {
        txHash: receipt.hash,
        amountTzs,
        toUserId,
        fromWallet: partner.treasuryWalletAddress,
        toWallet: toWallet.address,
      },
      { status: 201 }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[partners/disburse] Failed:', message)

    const isGasError =
      message.includes('INSUFFICIENT_FUNDS') ||
      message.includes('insufficient funds') ||
      message.includes('intrinsic transaction cost')

    return NextResponse.json(
      {
        error: isGasError
          ? 'Treasury wallet has insufficient ETH for gas. Please contact support.'
          : 'Disbursement failed. Please try again later.',
      },
      { status: 500 }
    )
  }
}
