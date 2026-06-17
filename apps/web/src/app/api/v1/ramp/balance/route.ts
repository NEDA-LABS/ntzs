import { NextRequest, NextResponse } from 'next/server'

import { requireRampPartner } from '@/lib/ramp/auth'
import { getOrCreateSettlementWallet, getSettlementUsdcBalance, USDC_BASE } from '@/lib/ramp/wallet'

export const runtime = 'nodejs'

/**
 * GET /api/v1/ramp/balance
 *
 * Returns the partner's ramp settlement address (where they pre-fund USDC) and
 * the current on-chain USDC float balance. Off-ramps debit this; on-ramps
 * credit it.
 */
export async function GET(req: NextRequest) {
  const auth = await requireRampPartner(req)
  if ('error' in auth) return auth.error

  try {
    const wallet = await getOrCreateSettlementWallet(auth.partner.id)
    const usdcBalance = await getSettlementUsdcBalance(wallet.address)
    return NextResponse.json({
      settlementAddress: wallet.address,
      chain: 'base',
      token: { symbol: 'USDC', address: USDC_BASE.address, decimals: USDC_BASE.decimals },
      usdcBalance,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to resolve settlement balance' },
      { status: 500 },
    )
  }
}
