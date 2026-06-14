import { NextResponse } from 'next/server'
import { db } from '@/lib/merchant/db'
import { merchantAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/merchant/auth'
import { JsonRpcProvider, Contract } from 'ethers'

const NTZS_ABI = ['function balanceOf(address) view returns (uint256)']

/**
 * GET /merchant/api/merchant/wallet
 * The merchant's on-chain nTZS wallet balance (e.g. capital received from a
 * lender, or settled funds), distinct from "total collected" sales stats.
 */
export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [merchant] = await db
    .select({ walletAddress: merchantAccounts.walletAddress })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, session.merchantId))
    .limit(1)

  if (!merchant?.walletAddress) {
    return NextResponse.json({ walletAddress: null, balanceTzs: 0 })
  }

  let balanceTzs = 0
  const rpcUrl = process.env.BASE_RPC_URL
  const tokenAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  if (rpcUrl && tokenAddress) {
    try {
      const provider = new JsonRpcProvider(rpcUrl)
      const token = new Contract(tokenAddress, NTZS_ABI, provider)
      const raw: bigint = await token.balanceOf(merchant.walletAddress)
      balanceTzs = Number(raw) / 1e18
    } catch {
      /* return 0 on RPC failure */
    }
  }

  return NextResponse.json({ walletAddress: merchant.walletAddress, balanceTzs })
}
