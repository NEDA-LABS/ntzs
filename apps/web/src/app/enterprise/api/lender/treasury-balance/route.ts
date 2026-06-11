import { NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, partners } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'
import { JsonRpcProvider, Contract } from 'ethers'

const NTZS_ABI = ['function balanceOf(address) view returns (uint256)']

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [account] = await db
    .select({ partnerId: enterpriseAccounts.partnerId })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account?.partnerId) return NextResponse.json({ error: 'No partner linked' }, { status: 403 })

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
    // Must match the token env var the rest of the app uses (wallet route,
    // executeMint, swaps all use NTZS_CONTRACT_ADDRESS_BASE). NTZS_TOKEN_ADDRESS
    // is unset, which silently made this fall back to 0 on the Overview card.
    const tokenAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
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
