import { NextRequest, NextResponse } from 'next/server'
import { eq, and, desc, or, sql } from 'drizzle-orm'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { requireAnyRole } from '@/lib/auth/rbac'
import {
  users,
  wallets,
  depositRequests,
  mintTransactions,
  burnRequests,
  auditLogs,
  lpFills,
} from '@ntzs/db'

/**
 * GET /api/backstage/trace-wallet?email=<email>
 * Admin-only diagnostic: trace all token movements for a user.
 */
export async function GET(request: NextRequest) {
  // Admin gate
  try {
    await requireAnyRole(['super_admin'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const email = request.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ error: 'email param required' }, { status: 400 })
  }

  const { db } = getDb()

  // 1. Find user
  const [user] = await db
    .select({ id: users.id, email: users.email, payAlias: users.payAlias })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // 2. Find ALL wallets for this user
  const allWallets = await db
    .select({ id: wallets.id, address: wallets.address, chain: wallets.chain, provider: wallets.provider, createdAt: wallets.createdAt })
    .from(wallets)
    .where(eq(wallets.userId, user.id))

  // The dashboard uses getCachedWallet which prefers platform_hd
  const dashboardWallet = allWallets.find(w => w.provider === 'platform_hd') ?? allWallets[0] ?? null
  const wallet = dashboardWallet

  // 3. Deposits + mint tx hashes
  const deposits = await db
    .select({
      id: depositRequests.id,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      paymentProvider: depositRequests.paymentProvider,
      pspReference: depositRequests.pspReference,
      createdAt: depositRequests.createdAt,
      mintedAt: depositRequests.mintedAt,
      walletId: depositRequests.walletId,
      mintTxHash: mintTransactions.txHash,
      mintContract: mintTransactions.contractAddress,
      mintStatus: mintTransactions.status,
    })
    .from(depositRequests)
    .leftJoin(mintTransactions, eq(mintTransactions.depositRequestId, depositRequests.id))
    .where(eq(depositRequests.userId, user.id))
    .orderBy(desc(depositRequests.createdAt))

  // 4. Burns
  const burns = await db
    .select({
      id: burnRequests.id,
      amountTzs: burnRequests.amountTzs,
      status: burnRequests.status,
      createdAt: burnRequests.createdAt,
    })
    .from(burnRequests)
    .where(eq(burnRequests.userId, user.id))
    .orderBy(desc(burnRequests.createdAt))

  // 5. Sends (from audit logs)
  const sends = await db
    .select({
      id: auditLogs.id,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'user_send_ntzs'),
        sql`${auditLogs.metadata}->>'fromUserId' = ${user.id}`
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(50)

  const sendRows = sends.map((s) => {
    const m = (s.metadata ?? {}) as Record<string, unknown>
    return {
      id: s.id,
      amountTzs: Number(m.amountTzs ?? 0),
      toAddress: String(m.toAddress ?? ''),
      burnTxHash: String(m.burnTxHash ?? ''),
      mintTxHash: String(m.mintTxHash ?? ''),
      createdAt: s.createdAt,
    }
  })

  // 6. Swaps
  let swapRows: Array<{
    id: string
    fromToken: string
    toToken: string
    amountIn: string
    amountOut: string
    outTxHash: string
    createdAt: Date
  }> = []
  if (wallet?.address) {
    swapRows = await db
      .select({
        id: lpFills.id,
        fromToken: lpFills.fromToken,
        toToken: lpFills.toToken,
        amountIn: lpFills.amountIn,
        amountOut: lpFills.amountOut,
        outTxHash: lpFills.outTxHash,
        createdAt: lpFills.createdAt,
      })
      .from(lpFills)
      .where(sql`lower(${lpFills.userAddress}) = ${wallet.address.toLowerCase()}`)
      .orderBy(desc(lpFills.createdAt))
      .limit(50)
  }

  // 7. On-chain balance for ALL wallets
  let onChainBalance: number | null = null
  const walletBalances: Array<{ id: string; address: string; provider: string | null; balance: number }> = []
  if (BASE_RPC_URL && NTZS_CONTRACT_ADDRESS_BASE) {
    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
      const token = new ethers.Contract(
        NTZS_CONTRACT_ADDRESS_BASE,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      )
      for (const w of allWallets) {
        try {
          const raw = await token.balanceOf(w.address) as bigint
          const bal = Number(raw / BigInt(10) ** BigInt(18))
          walletBalances.push({ id: w.id, address: w.address, provider: w.provider, balance: bal })
          if (w.id === wallet?.id) onChainBalance = bal
        } catch {}
      }
    } catch {}
  }

  // 8. Summaries
  const totalMinted = deposits
    .filter((d) => d.status === 'minted')
    .reduce((s, d) => s + d.amountTzs, 0)
  const totalBurned = burns
    .filter((b) => b.status === 'burned')
    .reduce((s, b) => s + b.amountTzs, 0)
  const totalSent = sendRows.reduce((s, t) => s + t.amountTzs, 0)
  const totalSwappedOut = swapRows
    .filter((sw) => sw.fromToken.toLowerCase().includes('ntzs'))
    .reduce((s, sw) => s + Number(sw.amountIn || 0), 0)

  // Check if all deposits minted to the correct wallet
  const walletMismatches = deposits
    .filter((d) => d.walletId && d.walletId !== wallet?.id)
    .map((d) => ({ depositId: d.id, expectedWalletId: wallet?.id, actualWalletId: d.walletId, amountTzs: d.amountTzs }))

  // Detect mismatch: dashboard wallet vs deposit wallet
  const depositWalletIds = [...new Set(deposits.filter(d => d.walletId).map(d => d.walletId))]
  const mintWalletMismatch = wallet && depositWalletIds.length > 0 && !depositWalletIds.includes(wallet.id)
    ? { dashboardWalletId: wallet.id, dashboardAddress: wallet.address, depositWalletIds, note: 'Dashboard shows a different wallet than where tokens are minted!' }
    : null

  return NextResponse.json({
    user: { id: user.id, email: user.email, alias: user.payAlias },
    dashboardWallet: wallet ? { id: wallet.id, address: wallet.address, chain: wallet.chain, provider: wallet.provider } : null,
    allWallets,
    walletBalances,
    mintWalletMismatch,
    onChainBalance,
    summary: {
      totalMinted,
      totalBurned,
      totalSent,
      totalSwappedOut,
      expectedBalance: totalMinted - totalBurned - totalSent - totalSwappedOut,
      actualBalance: onChainBalance,
      gap: onChainBalance !== null ? (totalMinted - totalBurned - totalSent - totalSwappedOut) - onChainBalance : null,
    },
    walletMismatches,
    deposits,
    burns,
    sends: sendRows,
    swaps: swapRows,
  })
}
