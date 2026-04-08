import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { authenticatePartner } from '@/lib/waas/auth'
import { users, wallets, partnerUsers } from '@ntzs/db'

const BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

const USDC_CONTRACT_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_DECIMALS = 6

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

  // Read nTZS and USDC balances in parallel
  let balanceTzs = 0
  let balanceUsdc = 0

  if (wallet?.address && !wallet.address.startsWith('0x_pending_')) {
    const rpcUrl = BASE_RPC_URL
    const ntzsAddress = NTZS_CONTRACT_ADDRESS_BASE

    if (rpcUrl && ntzsAddress) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl)
        const ntzsToken = new ethers.Contract(ntzsAddress, BALANCE_ABI, provider)
        const usdcToken = new ethers.Contract(USDC_CONTRACT_BASE, BALANCE_ABI, provider)

        const [ntzsWei, usdcRaw] = await Promise.all([
          ntzsToken.balanceOf(wallet.address) as Promise<bigint>,
          usdcToken.balanceOf(wallet.address) as Promise<bigint>,
        ])

        balanceTzs = Number(ntzsWei / (BigInt(10) ** BigInt(18)))
        balanceUsdc = Number(usdcRaw) / 10 ** USDC_DECIMALS
      } catch (err) {
        console.warn('[v1/users] Failed to read on-chain balances:', err instanceof Error ? err.message : err)
      }
    }
  }

  return NextResponse.json({
    id: user.id,
    externalId: mapping.externalId,
    email: user.email,
    phone: user.phone,
    walletAddress: wallet?.address || null,
    balanceTzs,
    balanceUsdc,
  })
}
