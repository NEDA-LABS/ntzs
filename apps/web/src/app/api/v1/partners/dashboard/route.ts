import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { eq, and, desc, inArray, or, sql } from 'drizzle-orm'

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

/** Return the later of two nullable date-like values as an ISO string */
function latestDate(a: Date | string | null | undefined, b: Date | string | null | undefined): string | null {
  const sa = a ? new Date(a).toISOString() : null
  const sb = b ? new Date(b).toISOString() : null
  if (!sa) return sb
  if (!sb) return sa
  return sa > sb ? sa : sb
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

  // 1. Partner info
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
      updatedAt: partners.updatedAt,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }

  // 2. All users — no cap, newest first
  const partnerUserRows = await db
    .select({
      id: users.id,
      externalId: partnerUsers.externalId,
      walletIndex: partnerUsers.walletIndex,
      email: users.email,
      name: users.name,
      phone: users.phone,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(partnerUsers)
    .innerJoin(users, eq(partnerUsers.userId, users.id))
    .where(eq(partnerUsers.partnerId, partnerId))
    .orderBy(desc(partnerUsers.createdAt))

  const userIds = partnerUserRows.map((u) => u.id)

  // 3. Batch wallet fetch — single inArray query instead of N+1
  const walletRows = userIds.length > 0
    ? await db
        .select({
          id: wallets.id,
          userId: wallets.userId,
          address: wallets.address,
          frozen: wallets.frozen,
          createdAt: wallets.createdAt,
          updatedAt: wallets.updatedAt,
        })
        .from(wallets)
        .where(and(inArray(wallets.userId, userIds), eq(wallets.chain, 'base')))
    : []

  const userWallets: Record<string, { id: string; userId: string; address: string; frozen: boolean; createdAt: Date; updatedAt: Date }> = {}
  for (const w of walletRows) {
    if (!userWallets[w.userId]) userWallets[w.userId] = w
  }

  // 4. Addresses for RPC balance calls
  const rpcUrl = BASE_RPC_URL
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
  const treasuryAddr = partner.treasuryWalletAddress
  const userAddrs: { uid: string; addr: string }[] = userIds
    .map((uid) => ({ uid, addr: userWallets[uid]?.address ?? '' }))
    .filter((x) => x.addr && !x.addr.startsWith('0x_pending_'))
  const allAddrs = [...(treasuryAddr ? [treasuryAddr] : []), ...userAddrs.map((x) => x.addr)]
  const userOnlyAddrs = userAddrs.map((x) => x.addr)

  // 5. All I/O in parallel: on-chain balances + per-user DB aggregates + display lists + pending queues
  const transferWhere = userIds.length > 0
    ? or(eq(transfers.partnerId, partnerId), inArray(transfers.fromUserId, userIds))
    : eq(transfers.partnerId, partnerId)

  const depositWhere = userIds.length > 0
    ? or(eq(depositRequests.partnerId, partnerId), inArray(depositRequests.userId, userIds))
    : eq(depositRequests.partnerId, partnerId)

  const [
    balanceMap,
    usdcMap,
    sentAggRows,
    receivedAggRows,
    depositAggRows,
    rawTransfers,
    rawDeposits,
    rawPendingTransfers,
    rawPendingDeposits,
  ] = await Promise.all([
    fetchERC20BalancesBatch(rpcUrl, contractAddress, allAddrs, 18),
    fetchERC20BalancesBatch(rpcUrl, USDC_CONTRACT_BASE, userOnlyAddrs, USDC_DECIMALS),

    // Transfer counts + last date per user (as sender)
    userIds.length > 0
      ? db
          .select({
            userId: transfers.fromUserId,
            totalSent: sql<number>`count(*)::int`,
            lastSentAt: sql<string | null>`max(${transfers.createdAt})`,
          })
          .from(transfers)
          .where(inArray(transfers.fromUserId, userIds))
          .groupBy(transfers.fromUserId)
      : Promise.resolve([] as { userId: string; totalSent: number; lastSentAt: string | null }[]),

    // Transfer counts + last date per user (as receiver)
    userIds.length > 0
      ? db
          .select({
            userId: transfers.toUserId,
            totalReceived: sql<number>`count(*)::int`,
            lastReceivedAt: sql<string | null>`max(${transfers.createdAt})`,
          })
          .from(transfers)
          .where(inArray(transfers.toUserId, userIds))
          .groupBy(transfers.toUserId)
      : Promise.resolve([] as { userId: string; totalReceived: number; lastReceivedAt: string | null }[]),

    // Deposit totals per user (minted only = successfully on-chain)
    userIds.length > 0
      ? db
          .select({
            userId: depositRequests.userId,
            totalDeposited: sql<string>`coalesce(sum(${depositRequests.amountTzs}), 0)`,
            totalDepositCount: sql<number>`count(*)::int`,
          })
          .from(depositRequests)
          .where(and(inArray(depositRequests.userId, userIds), eq(depositRequests.status, 'minted')))
          .groupBy(depositRequests.userId)
      : Promise.resolve([] as { userId: string; totalDeposited: string; totalDepositCount: number }[]),

    // Transfer display list (newest 500)
    db
      .select({
        id: transfers.id,
        fromUserId: transfers.fromUserId,
        toUserId: transfers.toUserId,
        amountTzs: transfers.amountTzs,
        status: transfers.status,
        txHash: transfers.txHash,
        createdAt: transfers.createdAt,
        updatedAt: transfers.updatedAt,
      })
      .from(transfers)
      .where(transferWhere)
      .orderBy(desc(transfers.createdAt))
      .limit(500),

    // Deposit display list (newest 500)
    db
      .select({
        id: depositRequests.id,
        userId: depositRequests.userId,
        amountTzs: depositRequests.amountTzs,
        status: depositRequests.status,
        pspReference: depositRequests.pspReference,
        pspChannel: depositRequests.pspChannel,
        payerName: depositRequests.payerName,
        buyerPhone: depositRequests.buyerPhone,
        fiatConfirmedAt: depositRequests.fiatConfirmedAt,
        mintedAt: depositRequests.mintedAt,
        createdAt: depositRequests.createdAt,
        updatedAt: depositRequests.updatedAt,
      })
      .from(depositRequests)
      .where(depositWhere)
      .orderBy(desc(depositRequests.createdAt))
      .limit(500),

    // Pending transfers — no limit, always complete
    db
      .select({
        id: transfers.id,
        fromUserId: transfers.fromUserId,
        toUserId: transfers.toUserId,
        amountTzs: transfers.amountTzs,
        status: transfers.status,
        txHash: transfers.txHash,
        createdAt: transfers.createdAt,
        updatedAt: transfers.updatedAt,
      })
      .from(transfers)
      .where(and(transferWhere, inArray(transfers.status, ['pending', 'submitted'])))
      .orderBy(desc(transfers.createdAt)),

    // Pending deposits — no limit (not yet minted/rejected/cancelled)
    db
      .select({
        id: depositRequests.id,
        userId: depositRequests.userId,
        amountTzs: depositRequests.amountTzs,
        status: depositRequests.status,
        pspChannel: depositRequests.pspChannel,
        payerName: depositRequests.payerName,
        buyerPhone: depositRequests.buyerPhone,
        createdAt: depositRequests.createdAt,
        updatedAt: depositRequests.updatedAt,
      })
      .from(depositRequests)
      .where(and(depositWhere, sql`${depositRequests.status} NOT IN ('minted', 'rejected', 'cancelled')`))
      .orderBy(desc(depositRequests.createdAt)),
  ])

  // 6. Build per-user stats maps
  const userSentMap: Record<string, { total: number; lastAt: string | null }> = {}
  for (const s of sentAggRows) userSentMap[s.userId] = { total: s.totalSent, lastAt: s.lastSentAt }

  const userReceivedMap: Record<string, { total: number; lastAt: string | null }> = {}
  for (const r of receivedAggRows) userReceivedMap[r.userId] = { total: r.totalReceived, lastAt: r.lastReceivedAt }

  const userDepositMap: Record<string, { totalDeposited: number; count: number }> = {}
  for (const d of depositAggRows) userDepositMap[d.userId] = { totalDeposited: Number(d.totalDeposited), count: d.totalDepositCount }

  // 7. Balance maps
  const userBalances: Record<string, number> = {}
  const userUsdcBalances: Record<string, number> = {}
  const uniqueAddressBalances = new Map<string, number>()
  for (const { uid, addr } of userAddrs) {
    const tzs = balanceMap[addr] ?? 0
    userBalances[uid] = tzs
    userUsdcBalances[uid] = usdcMap[addr] ?? 0
    uniqueAddressBalances.set(addr, tzs)
  }
  const totalBalanceTzs = Array.from(uniqueAddressBalances.values()).reduce((sum, b) => sum + b, 0)
  const treasuryBalanceTzs = treasuryAddr ? (balanceMap[treasuryAddr] ?? 0) : 0

  // 8. Build comprehensive user list
  const dashboardUsers = partnerUserRows.map((u) => {
    const wallet = userWallets[u.id]
    const sent = userSentMap[u.id]
    const received = userReceivedMap[u.id]
    const deposits = userDepositMap[u.id]
    return {
      id: u.id,
      externalId: u.externalId,
      walletIndex: u.walletIndex,
      email: u.email,
      name: u.name || null,
      phone: u.phone,
      walletId: wallet?.id || null,
      walletAddress: wallet?.address || null,
      walletFrozen: wallet?.frozen ?? false,
      walletCreatedAt: wallet?.createdAt || null,
      balanceTzs: userBalances[u.id] || 0,
      balanceUsdc: userUsdcBalances[u.id] || 0,
      totalTransfers: (sent?.total ?? 0) + (received?.total ?? 0),
      totalSent: sent?.total ?? 0,
      totalReceived: received?.total ?? 0,
      totalDeposited: deposits?.totalDeposited ?? 0,
      totalDepositCount: deposits?.count ?? 0,
      lastTransferAt: latestDate(sent?.lastAt, received?.lastAt),
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }
  })

  // 9. Sub-wallets
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

  const subWalletBalances: Record<string, number> = {}
  if (subWalletRows.length > 0) {
    const swAddrs = subWalletRows.map((sw) => sw.address)
    const swMap = await fetchERC20BalancesBatch(rpcUrl, contractAddress, swAddrs)
    for (const sw of subWalletRows) {
      subWalletBalances[sw.id] = swMap[sw.address] ?? 0
    }
  }
  const subWallets = subWalletRows.map((sw) => ({ ...sw, balanceTzs: subWalletBalances[sw.id] ?? 0 }))
  const totalSubWalletBalance = subWallets.reduce((sum, sw) => sum + sw.balanceTzs, 0)
  const totalBalanceAllWallets = treasuryBalanceTzs + totalBalanceTzs + totalSubWalletBalance

  // 10. Build user lookup for name/email resolution
  const userLookup: Record<string, { email: string; name: string | null }> = {}
  for (const u of partnerUserRows) {
    userLookup[u.id] = { email: u.email, name: u.name || null }
  }

  // 11. Batch-resolve any user IDs not already in lookup
  const missingIds = new Set<string>()
  for (const t of [...rawTransfers, ...rawPendingTransfers]) {
    if (!userLookup[t.fromUserId]) missingIds.add(t.fromUserId)
    if (!userLookup[t.toUserId]) missingIds.add(t.toUserId)
  }
  for (const d of [...rawDeposits, ...rawPendingDeposits]) {
    if (!userLookup[d.userId]) missingIds.add(d.userId)
  }
  if (missingIds.size > 0) {
    const resolved = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(inArray(users.id, Array.from(missingIds)))
    for (const u of resolved) {
      userLookup[u.id] = { email: u.email, name: u.name || null }
    }
  }

  // 12. Enrich transfer rows
  const transferRows = rawTransfers.map((t) => ({
    ...t,
    fromEmail: userLookup[t.fromUserId]?.email || null,
    fromName: userLookup[t.fromUserId]?.name || null,
    toEmail: userLookup[t.toUserId]?.email || null,
    toName: userLookup[t.toUserId]?.name || null,
  }))

  const pendingTransferRows = rawPendingTransfers.map((t) => ({
    ...t,
    fromEmail: userLookup[t.fromUserId]?.email || null,
    fromName: userLookup[t.fromUserId]?.name || null,
    toEmail: userLookup[t.toUserId]?.email || null,
    toName: userLookup[t.toUserId]?.name || null,
  }))

  // 13. Enrich deposit rows
  const depositRows = rawDeposits.map((d) => ({
    ...d,
    userEmail: userLookup[d.userId]?.email || null,
    userName: userLookup[d.userId]?.name || null,
  }))

  const pendingDepositRows = rawPendingDeposits.map((d) => ({
    ...d,
    userEmail: userLookup[d.userId]?.email || null,
    userName: userLookup[d.userId]?.name || null,
  }))

  // 14. Recent activity — merged timeline of last 20 events
  const recentActivity = [
    ...transferRows.slice(0, 20).map((t) => ({
      type: 'transfer' as const,
      id: t.id,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      amountTzs: t.amountTzs,
      status: t.status,
      fromEmail: t.fromEmail,
      fromName: t.fromName,
      toEmail: t.toEmail,
      toName: t.toName,
      txHash: t.txHash,
    })),
    ...depositRows.slice(0, 20).map((d) => ({
      type: 'deposit' as const,
      id: d.id,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      amountTzs: d.amountTzs,
      status: d.status,
      userEmail: d.userEmail,
      userName: d.userName,
      pspChannel: d.pspChannel,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20)

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
      updatedAt: partner.updatedAt,
    },
    users: dashboardUsers,
    subWallets,
    transfers: transferRows,
    deposits: depositRows,
    pendingTransfers: pendingTransferRows,
    pendingDeposits: pendingDepositRows,
    recentActivity,
    stats: {
      totalUsers: dashboardUsers.length,
      totalWallets: dashboardUsers.length + (partner.treasuryWalletAddress ? 1 : 0) + subWallets.length,
      totalBalanceTzs: totalBalanceAllWallets,
      totalTransfers: transferRows.length,
      totalDeposits: depositRows.length,
      pendingTransfers: pendingTransferRows.length,
      pendingDeposits: pendingDepositRows.length,
    },
  })
}
