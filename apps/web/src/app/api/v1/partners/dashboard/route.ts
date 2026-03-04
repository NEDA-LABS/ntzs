import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { partners, partnerUsers, partnerSubWallets, users, wallets, transfers, depositRequests } from '@ntzs/db'

function verifySessionToken(token: string): string | null {
  const secret = process.env.APP_SECRET || 'dev-secret-do-not-use'
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, sig] = parts
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded!).digest('base64url')

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
 * GET /api/v1/partners/dashboard — Fetch partner dashboard data
 */
export async function GET(request: NextRequest) {
  // Auth from cookie or Authorization header
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

  const { db } = getDb()

  // Get partner info
  const [partner] = await db
    .select({
      id: partners.id,
      name: partners.name,
      email: partners.email,
      apiKeyPrefix: partners.apiKeyPrefix,
      webhookUrl: partners.webhookUrl,
      nextWalletIndex: partners.nextWalletIndex,
      treasuryWalletAddress: partners.treasuryWalletAddress,
      feePercent: partners.feePercent,
      createdAt: partners.createdAt,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }

  // Get all users for this partner
  const partnerUserRows = await db
    .select({
      id: users.id,
      externalId: partnerUsers.externalId,
      email: users.email,
      name: users.name,
      phone: users.phone,
      createdAt: users.createdAt,
    })
    .from(partnerUsers)
    .innerJoin(users, eq(partnerUsers.userId, users.id))
    .where(eq(partnerUsers.partnerId, partnerId))
    .limit(100)

  // Get wallets for all partner users
  const userIds = partnerUserRows.map((u) => u.id)

  const userWallets: Record<string, string> = {}
  if (userIds.length > 0) {
    for (const uid of userIds) {
      const [w] = await db
        .select({ address: wallets.address })
        .from(wallets)
        .where(and(eq(wallets.userId, uid), eq(wallets.chain, 'base')))
        .limit(1)
      if (w) userWallets[uid] = w.address
    }
  }

  // Get on-chain balances (best-effort, fallback to 0)
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL
  const contractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.NTZS_CONTRACT_ADDRESS_BASE

  // Get treasury wallet balance
  let treasuryBalanceTzs = 0
  if (partner.treasuryWalletAddress && rpcUrl && contractAddress) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const token = new ethers.Contract(
        contractAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      )
      const bal: bigint = await token.balanceOf(partner.treasuryWalletAddress)
      treasuryBalanceTzs = Number(bal / BigInt(10) ** BigInt(18))
    } catch {
      // RPC error, balance stays 0
    }
  }

  const userBalances: Record<string, number> = {}
  let totalBalanceTzs = 0

  if (rpcUrl && contractAddress) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const token = new ethers.Contract(
        contractAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      )

      for (const uid of userIds) {
        const addr = userWallets[uid]
        if (addr && !addr.startsWith('0x_pending_')) {
          try {
            const bal: bigint = await token.balanceOf(addr)
            const tzs = Number(bal / BigInt(10) ** BigInt(18))
            userBalances[uid] = tzs
            totalBalanceTzs += tzs
          } catch {
            userBalances[uid] = 0
          }
        }
      }
    } catch {
      // RPC error, balances will be 0
    }
  }

  // Build user list with balances
  const dashboardUsers = partnerUserRows.map((u) => ({
    id: u.id,
    externalId: u.externalId,
    email: u.email,
    name: u.name || null,
    phone: u.phone,
    walletAddress: userWallets[u.id] || null,
    balanceTzs: userBalances[u.id] || 0,
    createdAt: u.createdAt,
  }))

  // Fetch partner sub-wallets
  const subWalletRows = await db
    .select({
      id: partnerSubWallets.id,
      label: partnerSubWallets.label,
      address: partnerSubWallets.address,
      walletIndex: partnerSubWallets.walletIndex,
      createdAt: partnerSubWallets.createdAt,
    })
    .from(partnerSubWallets)
    .where(eq(partnerSubWallets.partnerId, partnerId))
    .orderBy(partnerSubWallets.walletIndex)

  // Get on-chain balances for sub-wallets
  const subWalletBalances: Record<string, number> = {}
  if (rpcUrl && contractAddress && subWalletRows.length > 0) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const token = new ethers.Contract(
        contractAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      )
      for (const sw of subWalletRows) {
        try {
          const bal: bigint = await token.balanceOf(sw.address)
          subWalletBalances[sw.id] = Number(bal / BigInt(10) ** BigInt(18))
        } catch {
          subWalletBalances[sw.id] = 0
        }
      }
    } catch {
      // RPC error — balances stay 0
    }
  }

  const subWallets = subWalletRows.map((sw) => ({
    ...sw,
    balanceTzs: subWalletBalances[sw.id] ?? 0,
  }))

  // Build email/name lookup for transfer resolution
  const userLookup: Record<string, { email: string; name: string | null }> = {}
  for (const u of partnerUserRows) {
    userLookup[u.id] = { email: u.email, name: u.name || null }
  }

  // Get transfers for this partner with resolved names/emails
  const rawTransfers = await db
    .select({
      id: transfers.id,
      fromUserId: transfers.fromUserId,
      toUserId: transfers.toUserId,
      amountTzs: transfers.amountTzs,
      status: transfers.status,
      txHash: transfers.txHash,
      createdAt: transfers.createdAt,
    })
    .from(transfers)
    .where(eq(transfers.partnerId, partnerId))
    .limit(50)

  // Resolve any user IDs not already in lookup (edge case: users from other queries)
  const missingIds = new Set<string>()
  for (const t of rawTransfers) {
    if (!userLookup[t.fromUserId]) missingIds.add(t.fromUserId)
    if (!userLookup[t.toUserId]) missingIds.add(t.toUserId)
  }
  if (missingIds.size > 0) {
    for (const uid of missingIds) {
      const [u] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, uid))
        .limit(1)
      if (u) userLookup[uid] = { email: u.email, name: u.name || null }
    }
  }

  const transferRows = rawTransfers.map((t) => ({
    ...t,
    fromEmail: userLookup[t.fromUserId]?.email || null,
    fromName: userLookup[t.fromUserId]?.name || null,
    toEmail: userLookup[t.toUserId]?.email || null,
    toName: userLookup[t.toUserId]?.name || null,
  }))

  // Get deposits for this partner
  const depositRows = await db
    .select({
      id: depositRequests.id,
      userId: depositRequests.userId,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      pspReference: depositRequests.pspReference,
      createdAt: depositRequests.createdAt,
    })
    .from(depositRequests)
    .where(eq(depositRequests.partnerId, partnerId))
    .limit(50)

  return NextResponse.json({
    partner: {
      id: partner.id,
      name: partner.name,
      email: partner.email,
      apiKeyPrefix: partner.apiKeyPrefix || 'ntzs_test_',
      webhookUrl: partner.webhookUrl,
      nextWalletIndex: partner.nextWalletIndex,
      treasuryWalletAddress: partner.treasuryWalletAddress,
      feePercent: parseFloat(String(partner.feePercent ?? '0')),
      treasuryBalanceTzs,
      createdAt: partner.createdAt,
    },
    users: dashboardUsers,
    subWallets,
    transfers: transferRows,
    deposits: depositRows,
    stats: {
      totalUsers: dashboardUsers.length,
      totalWallets: dashboardUsers.length + (partner.treasuryWalletAddress ? 1 : 0) + subWallets.length,
      totalBalanceTzs,
      totalTransfers: transferRows.length,
      totalDeposits: depositRows.length,
    },
  })
}
