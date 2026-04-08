import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { eq, and, desc, inArray, or } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { partners, partnerUsers, partnerSubWallets, users, wallets, transfers, depositRequests } from '@ntzs/db'

const USDC_CONTRACT_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_DECIMALS = 6

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

/** Fetch ERC-20 balances for multiple addresses in a single JSON-RPC batch call */
async function fetchERC20BalancesBatch(
  rpcUrl: string,
  contractAddress: string,
  addresses: string[],
  decimals = 18
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {}
  const batch = addresses.map((addr, i) => ({
    jsonrpc: '2.0',
    method: 'eth_call',
    params: [
      { to: contractAddress, data: '0x70a08231' + addr.toLowerCase().replace('0x', '').padStart(64, '0') },
      'latest',
    ],
    id: i,
  }))
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(15000),
    })
    const results = await res.json() as Array<{ id: number; result?: string; error?: unknown }>
    const out: Record<string, number> = {}
    for (const item of results) {
      const addr = addresses[item.id]
      if (!addr) continue
      if (item.error || !item.result || item.result === '0x') {
        out[addr] = 0
      } else {
        // For high-decimal tokens (>=18) use BigInt division to avoid float overflow
        // For low-decimal tokens like USDC (6) use float division to preserve cents
        out[addr] = decimals >= 18
          ? Number(BigInt(item.result) / BigInt(10) ** BigInt(decimals))
          : Number(BigInt(item.result)) / 10 ** decimals
      }
    }
    return out
  } catch {
    return {}
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
      payoutPhone: partners.payoutPhone,
      payoutType: partners.payoutType,
      payoutBankAccount: partners.payoutBankAccount,
      payoutBankName: partners.payoutBankName,
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

  const userWallets: Record<string, { id: string; address: string; frozen: boolean }> = {}
  if (userIds.length > 0) {
    const walletResults = await Promise.all(
      userIds.map((uid) =>
        db
          .select({ id: wallets.id, address: wallets.address, frozen: wallets.frozen })
          .from(wallets)
          .where(and(eq(wallets.userId, uid), eq(wallets.chain, 'base')))
          .limit(1)
          .then(([w]) => ({ uid, w }))
      )
    )
    for (const { uid, w } of walletResults) {
      if (w) userWallets[uid] = w
    }
  }

  // Get on-chain balances using raw JSON-RPC fetch (more reliable in serverless than ethers provider)
  const rpcUrl = BASE_RPC_URL
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE

  // Collect all addresses to query in one batch RPC call
  const treasuryAddr = partner.treasuryWalletAddress
  const userAddrs: { uid: string; addr: string }[] = userIds
    .map((uid) => ({ uid, addr: userWallets[uid]?.address ?? '' }))
    .filter((x) => x.addr && !x.addr.startsWith('0x_pending_'))

  const allAddrs = [
    ...(treasuryAddr ? [treasuryAddr] : []),
    ...userAddrs.map((x) => x.addr),
  ]

  const userOnlyAddrs = userAddrs.map((x) => x.addr)

  const [balanceMap, usdcMap] = await Promise.all([
    fetchERC20BalancesBatch(rpcUrl, contractAddress, allAddrs, 18),
    fetchERC20BalancesBatch(rpcUrl, USDC_CONTRACT_BASE, userOnlyAddrs, USDC_DECIMALS),
  ])

  const treasuryBalanceTzs = treasuryAddr ? (balanceMap[treasuryAddr] ?? 0) : 0

  const userBalances: Record<string, number> = {}
  const userUsdcBalances: Record<string, number> = {}
  const uniqueAddressBalances = new Map<string, number>()
  
  for (const { uid, addr } of userAddrs) {
    const tzs = balanceMap[addr] ?? 0
    userBalances[uid] = tzs
    userUsdcBalances[uid] = usdcMap[addr] ?? 0
    uniqueAddressBalances.set(addr, tzs)
  }
  
  const totalBalanceTzs = Array.from(uniqueAddressBalances.values()).reduce((sum, bal) => sum + bal, 0)

  // Build user list with balances
  const dashboardUsers = partnerUserRows.map((u) => ({
    id: u.id,
    externalId: u.externalId,
    email: u.email,
    name: u.name || null,
    phone: u.phone,
    walletId: userWallets[u.id]?.id || null,
    walletAddress: userWallets[u.id]?.address || null,
    walletFrozen: userWallets[u.id]?.frozen ?? false,
    balanceTzs: userBalances[u.id] || 0,
    balanceUsdc: userUsdcBalances[u.id] || 0,
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

  // Get on-chain balances for sub-wallets (batched)
  const subWalletBalances: Record<string, number> = {}
  if (subWalletRows.length > 0) {
    const swAddrs = subWalletRows.map((sw) => sw.address)
    const swMap = await fetchERC20BalancesBatch(rpcUrl, contractAddress, swAddrs)
    for (const sw of subWalletRows) {
      subWalletBalances[sw.id] = swMap[sw.address] ?? 0
    }
  }

  const subWallets = subWalletRows.map((sw) => ({
    ...sw,
    balanceTzs: subWalletBalances[sw.id] ?? 0,
  }))

  // Calculate total balance across all wallets (treasury + users + sub-wallets)
  const totalSubWalletBalance = subWallets.reduce((sum, sw) => sum + sw.balanceTzs, 0)
  const totalBalanceAllWallets = treasuryBalanceTzs + totalBalanceTzs + totalSubWalletBalance

  // Build email/name lookup for transfer resolution
  const userLookup: Record<string, { email: string; name: string | null }> = {}
  for (const u of partnerUserRows) {
    userLookup[u.id] = { email: u.email, name: u.name || null }
  }

  // Get transfers for this partner — match by partnerId OR by user membership
  // (handles transfers created before partnerId was reliably stamped)
  const transferWhere = userIds.length > 0
    ? or(eq(transfers.partnerId, partnerId), inArray(transfers.fromUserId, userIds))
    : eq(transfers.partnerId, partnerId)

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
    .where(transferWhere)
    .orderBy(desc(transfers.createdAt))
    .limit(200)

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

  // Get deposits for this partner — match by partnerId OR by user membership
  const depositWhere = userIds.length > 0
    ? or(eq(depositRequests.partnerId, partnerId), inArray(depositRequests.userId, userIds))
    : eq(depositRequests.partnerId, partnerId)

  const depositRows = await db
    .select({
      id: depositRequests.id,
      userId: depositRequests.userId,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      pspReference: depositRequests.pspReference,
      pspChannel: depositRequests.pspChannel,
      fiatConfirmedAt: depositRequests.fiatConfirmedAt,
      mintedAt: depositRequests.mintedAt,
      createdAt: depositRequests.createdAt,
    })
    .from(depositRequests)
    .where(depositWhere)
    .orderBy(desc(depositRequests.createdAt))
    .limit(200)

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
      payoutPhone: partner.payoutPhone ?? null,
      payoutType: partner.payoutType ?? 'mobile',
      payoutBankAccount: partner.payoutBankAccount ?? null,
      payoutBankName: partner.payoutBankName ?? null,
      createdAt: partner.createdAt,
    },
    users: dashboardUsers,
    subWallets,
    transfers: transferRows,
    deposits: depositRows,
    stats: {
      totalUsers: dashboardUsers.length,
      totalWallets: dashboardUsers.length + (partner.treasuryWalletAddress ? 1 : 0) + subWallets.length,
      totalBalanceTzs: totalBalanceAllWallets,
      totalTransfers: transferRows.length,
      totalDeposits: depositRows.length,
    },
  })
}
