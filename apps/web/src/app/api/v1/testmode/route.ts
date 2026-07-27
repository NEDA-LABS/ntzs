import { NextRequest, NextResponse } from 'next/server'

import { authenticatePartner } from '@/lib/waas/auth'
import { spendEnabled, spendKindEnabled } from '@/lib/waas/spend-quote'
import { isTestMode, listTransactions, settleDelayMs, settleDue, TEST_SCENARIOS } from '@/lib/testmode'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/testmode — "which world am I in, and how do I drive it?"
 *
 * The first call an integrator should make. It answers the two questions a
 * sandbox has to answer honestly: whether this key moves real money, and what
 * inputs produce which outcomes. It also reports which rails are actually
 * enabled in PRODUCTION, so nobody mistakes "works in test mode" for "live".
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult

  if (!isTestMode(partner)) {
    return NextResponse.json({
      livemode: true,
      mode: 'live',
      message:
        'This is a LIVE key — every call moves real money. Get a test key from the developer dashboard (or POST /api/v1/testmode/signup) to use the sandbox.',
    })
  }

  await settleDue(partner.id)
  const recent = await listTransactions(partner.id, 20)

  return NextResponse.json({
    livemode: false,
    mode: 'test',
    partner: { id: partner.id, name: partner.name },
    settleDelaySeconds: settleDelayMs() / 1000,
    scenarios: TEST_SCENARIOS,
    controls: {
      advance: 'POST /api/v1/testmode/advance — settle every due transaction now instead of waiting.',
      approveUser: 'POST /api/v1/testmode/users/{userId}/approve — clear a simulated manual KYC review.',
      reset: 'POST /api/v1/testmode/reset — delete every test user and transaction for this key.',
    },
    // What is switched on in PRODUCTION today. Test mode runs every rail, so
    // this is the only place that tells the truth about go-live readiness.
    liveRails: {
      spend: spendEnabled(),
      lipa: spendKindEnabled('lipa'),
      bill: spendKindEnabled('bill'),
      rampToSpend: process.env.RAMP_SPEND_ENABLED === 'true',
    },
    recentTransactions: recent.map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      amountTzs: t.amountTzs,
      createdAt: t.createdAt,
      settledAt: t.settledAt,
    })),
    note: 'Test mode never touches the chain, a payment provider, or the nTZS reserve. Balances here are simulated.',
  })
}
