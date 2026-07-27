import { NextRequest, NextResponse } from 'next/server'

import { authenticatePartner } from '@/lib/waas/auth'
import { isTestMode, settleDue } from '@/lib/testmode'

/**
 * POST /api/v1/testmode/advance — settle every due transaction immediately.
 *
 * Test mode settles on the next API call, which is fine for a human clicking
 * around but wasteful in CI. This makes the wait explicit and skippable: create
 * a deposit, call advance, assert the balance. Transactions parked on the
 * "stays pending" scenario (…99) are never advanced — that is the point of them.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult

  if (!isTestMode(partner)) {
    return NextResponse.json(
      { error: 'test_mode_only', message: 'This endpoint is only available to test-mode keys.' },
      { status: 400 }
    )
  }

  // Sweeping with a far-future clock settles everything that has a due time,
  // regardless of how much of the delay has actually elapsed.
  const settled = await settleDue(partner.id, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))
  return NextResponse.json({ livemode: false, settled })
}
