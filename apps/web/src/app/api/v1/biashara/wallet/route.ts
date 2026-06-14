import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/merchant/db'
import { merchantAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { requireServiceKey } from '@/lib/service-auth'
import { JsonRpcProvider, Contract } from 'ethers'

const NTZS_ABI = ['function balanceOf(address) view returns (uint256)']

/**
 * GET /api/v1/biashara/wallet  (NEDApay service layer)
 * The merchant's on-chain nTZS wallet balance (financing received / settled).
 * Headers: x-service-key, x-merchant-id.
 */
export async function GET(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })

  const [merchant] = await db
    .select({ walletAddress: merchantAccounts.walletAddress })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant?.walletAddress) return NextResponse.json({ walletAddress: null, balanceTzs: 0 })

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
