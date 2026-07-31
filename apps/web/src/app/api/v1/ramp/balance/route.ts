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
    const msg = err instanceof Error ? err.message : String(err)
    // This is the FIRST call a new ramp partner makes (it returns the funding
    // address), so a provisioning failure surfaces here — as a told-what-to-do
    // 503, not a bare 500. A live partner reported exactly that 500. The
    // wallet now self-provisions its seed, so reaching this branch means the
    // provisioning itself failed (e.g. the seed encryption env).
    if (/seed|encrypt/i.test(msg)) {
      return NextResponse.json(
        {
          error: 'ramp_not_provisioned',
          message:
            'Your ramp settlement wallet could not be provisioned — contact NEDA Labs. Do not send funds anywhere until this endpoint returns your settlement address.',
        },
        { status: 503 },
      )
    }
    const requestId = crypto.randomUUID()
    console.error(`[v1/ramp/balance] ${requestId}`, msg)
    return NextResponse.json(
      { error: 'ramp_unavailable', message: 'Could not read the settlement float right now. Retry shortly.', requestId },
      { status: 502 },
    )
  }
}
