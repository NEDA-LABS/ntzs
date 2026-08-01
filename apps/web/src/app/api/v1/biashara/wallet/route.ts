import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/merchant/db'
import { merchantAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { requireBiasharaMerchant } from '@/lib/biashara/caller'
import { JsonRpcProvider, Contract } from 'ethers'
import { MIN_WITHDRAWAL_TZS, WITHDRAWAL_FEE_PCT } from '@/lib/payouts/payout-math'
import { expectedDisbursementRail, expectedPayoutFeeTzs } from '@/lib/psp'

const NTZS_ABI = ['function balanceOf(address) view returns (uint256)']

/**
 * GET /api/v1/biashara/wallet  (NEDApay service layer)
 * The merchant's on-chain nTZS wallet balance (financing received / settled).
 * Headers: x-service-key, x-merchant-id.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireBiasharaMerchant(req)
  if ('error' in authResult) return authResult.error
  const { merchantId } = authResult

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

  return NextResponse.json({
    walletAddress: merchant.walletAddress,
    balanceTzs,
    // Explicit balance withdrawal (POST /api/v1/biashara/withdraw) is always
    // available — it burns the merchant's OWN balance and needs no lender.
    // Render the wallet card + Withdraw button whenever walletAddress exists,
    // independent of financing state.
    withdraw: {
      enabled: true,
      endpoint: '/api/v1/biashara/withdraw',
      minReceiveTzs: MIN_WITHDRAWAL_TZS,
      // PSP fee is priced on the serving rail and varies with amount (Selcom
      // is tiered); this figure is the fee AT THE MINIMUM withdrawal — the
      // withdraw response returns the exact pspFeeTzs for the actual amount.
      payoutRail: expectedDisbursementRail(),
      pspFlatFeeTzs: expectedPayoutFeeTzs(MIN_WITHDRAWAL_TZS),
      platformFeePct: WITHDRAWAL_FEE_PCT,
    },
  })
}
