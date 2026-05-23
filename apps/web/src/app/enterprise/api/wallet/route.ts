import { NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, partners, transfers, enterpriseWithdrawRequests } from '@ntzs/db'
import { eq, desc } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'
import { JsonRpcProvider, Contract } from 'ethers'

const NTZS_ABI = ['function balanceOf(address) view returns (uint256)']

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [account] = await db
    .select({ partnerId: enterpriseAccounts.partnerId, name: enterpriseAccounts.name })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account?.partnerId) {
    return NextResponse.json({
      walletAddress: null,
      balanceTzs: 0,
      recentTransfers: [],
      pendingWithdrawals: [],
    })
  }

  const [partner] = await db
    .select({ treasuryWalletAddress: partners.treasuryWalletAddress })
    .from(partners)
    .where(eq(partners.id, account.partnerId))
    .limit(1)

  const walletAddress = partner?.treasuryWalletAddress ?? null

  // On-chain balance
  let balanceTzs = 0
  if (walletAddress) {
    try {
      const rpcUrl = process.env.BASE_RPC_URL
      const tokenAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
      if (rpcUrl && tokenAddress) {
        const provider = new JsonRpcProvider(rpcUrl)
        const token = new Contract(tokenAddress, NTZS_ABI, provider)
        const raw: bigint = await token.balanceOf(walletAddress)
        balanceTzs = Number(raw) / 1e18
      }
    } catch { /* return 0 on RPC failure */ }
  }

  // Recent incoming transfers (lender repayments, mints, etc.)
  const recentTransfers = await db
    .select({
      id: transfers.id,
      amountTzs: transfers.amountTzs,
      status: transfers.status,
      txHash: transfers.txHash,
      metadata: transfers.metadata,
      createdAt: transfers.createdAt,
    })
    .from(transfers)
    .where(eq(transfers.partnerId, account.partnerId))
    .orderBy(desc(transfers.createdAt))
    .limit(20)

  // Withdrawal requests (outgoing)
  const pendingWithdrawals = await db
    .select({
      id: enterpriseWithdrawRequests.id,
      amountTzs: enterpriseWithdrawRequests.amountTzs,
      payoutMethod: enterpriseWithdrawRequests.payoutMethod,
      payoutPhone: enterpriseWithdrawRequests.payoutPhone,
      status: enterpriseWithdrawRequests.status,
      createdAt: enterpriseWithdrawRequests.createdAt,
    })
    .from(enterpriseWithdrawRequests)
    .where(eq(enterpriseWithdrawRequests.enterpriseId, session.enterpriseId))
    .orderBy(desc(enterpriseWithdrawRequests.createdAt))
    .limit(20)

  return NextResponse.json({
    walletAddress,
    balanceTzs,
    accountName: account.name,
    recentTransfers: recentTransfers.map(t => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      direction: 'in' as const,
      label: (t.metadata as Record<string, string> | null)?.reason ?? 'transfer',
    })),
    pendingWithdrawals: pendingWithdrawals.map(w => ({
      ...w,
      createdAt: w.createdAt.toISOString(),
    })),
  })
}
