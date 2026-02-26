import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { users, wallets, partnerUsers } from '@ntzs/db'

const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

/**
 * GET /api/v1/users/:id — Get user profile and nTZS balance
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult
  const { id: userId } = await params

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

  const [user] = await db
    .select({ id: users.id, email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const [wallet] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)

  // Try to read on-chain balance
  let balanceTzs = 0
  if (wallet?.address && !wallet.address.startsWith('0x_pending_')) {
    try {
      const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL
      const contractAddress =
        process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.NTZS_CONTRACT_ADDRESS_BASE

      if (rpcUrl && contractAddress) {
        const provider = new ethers.JsonRpcProvider(rpcUrl)
        const token = new ethers.Contract(contractAddress, NTZS_BALANCE_ABI, provider)
        const balanceWei: bigint = await token.balanceOf(wallet.address)
        balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))
      }
    } catch (err) {
      console.warn('[v1/users] Failed to read on-chain balance:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({
    id: user.id,
    externalId: mapping.externalId,
    email: user.email,
    phone: user.phone,
    walletAddress: wallet?.address || null,
    balanceTzs,
  })
}
