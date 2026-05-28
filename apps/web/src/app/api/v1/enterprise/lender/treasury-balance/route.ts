import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, partners } from '@ntzs/db'
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
    .select({ partnerId: enterpriseAccounts.partnerId })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, enterpriseId))
    .limit(1)

  if (!account?.partnerId) {
    return NextResponse.json({ error: 'No partner linked' }, { status: 403 })
  }

  const [partner] = await db
    .select({ treasuryWalletAddress: partners.treasuryWalletAddress })
    .from(partners)
    .where(eq(partners.id, account.partnerId))
    .limit(1)

  if (!partner?.treasuryWalletAddress) {
    return NextResponse.json({ balanceTzs: 0, address: null })
  }

  try {
    const rpcUrl = process.env.BASE_RPC_URL
    const tokenAddress = process.env.NTZS_TOKEN_ADDRESS
    if (!rpcUrl || !tokenAddress) {
      return NextResponse.json({ balanceTzs: 0, address: partner.treasuryWalletAddress })
    }

    const provider = new JsonRpcProvider(rpcUrl)
    const token = new Contract(tokenAddress, NTZS_ABI, provider)
    const rawBalance: bigint = await token.balanceOf(partner.treasuryWalletAddress)
    const balanceTzs = Number(rawBalance) / 1e18

    return NextResponse.json({ balanceTzs, address: partner.treasuryWalletAddress })
  } catch {
    return NextResponse.json({ balanceTzs: 0, address: partner.treasuryWalletAddress })
  }
}
