import { NextRequest, NextResponse } from 'next/server'

import { authenticatePartner } from '@/lib/waas/auth'
import { isTestMode, resetPartner } from '@/lib/testmode'

/**
 * POST /api/v1/testmode/reset — delete every simulated user and transaction
 * for this key. Live keys are refused outright; the handler only ever touches
 * test_mode_* tables, so there is nothing real for it to delete.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult

  if (!isTestMode(partner)) {
    return NextResponse.json(
      { error: 'test_mode_only', message: 'Reset is only available to test-mode keys.' },
      { status: 400 }
    )
  }

  const { users } = await resetPartner(partner.id)
  return NextResponse.json({ livemode: false, deletedUsers: users, message: 'Sandbox reset.' })
}
