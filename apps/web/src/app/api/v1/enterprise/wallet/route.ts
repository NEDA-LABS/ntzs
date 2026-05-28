import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseWithdrawRequests, partners, transfers } from '@ntzs/db'
import { requireServiceKey } from '@/lib/service-auth'
import { JsonRpcProvider, Contract } from 'ethers'

const NTZS_ABI = ['function balanceOf(address) view returns (uint256)']

export async function GET(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const enterpriseId = req.headers.get('x-enterprise-id')
  if (!enterpriseId) {
    return NextResponse.json({ error: 'x-enterprise-id header required' }, { status: 400 })
  }

  const [account] = await db
    .select({ partnerId: enterpriseAccounts.partnerId, name: enterpriseAccounts.name })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, enterpriseId))
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
    .where(eq(enterpriseWithdrawRequests.enterpriseId, enterpriseId))
    .orderBy(desc(enterpriseWithdrawRequests.createdAt))
    .limit(20)

  return NextResponse.json({
    walletAddress,
    balanceTzs,
    accountName: account.name,
    recentTransfers: recentTransfers.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      direction: 'in' as const,
      label: (t.metadata as Record<string, string> | null)?.reason ?? 'transfer',
    })),
    pendingWithdrawals: pendingWithdrawals.map((w) => ({
      ...w,
      createdAt: w.createdAt.toISOString(),
    })),
  })
}
