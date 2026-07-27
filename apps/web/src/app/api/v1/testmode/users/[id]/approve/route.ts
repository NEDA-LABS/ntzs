import { NextRequest, NextResponse } from 'next/server'

import { authenticatePartner } from '@/lib/waas/auth'
import { approveUser, findUserById, isTestMode } from '@/lib/testmode'
import { queueTestKycWebhook } from '@/lib/testmode/engine'

/**
 * POST /api/v1/testmode/users/:id/approve — clear a simulated manual review.
 *
 * In production a `202 kyc_pending_review` user waits for a human in
 * Backstage. Test mode gives you the same 202 (NIDA ending 0000) and this
 * button to resolve it, so the whole review branch — including the
 * `kyc.updated` webhook and the idempotent re-call that returns the
 * walletAddress — is testable in seconds.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult
  const { id } = await params

  if (!isTestMode(partner)) {
    return NextResponse.json(
      { error: 'test_mode_only', message: 'This endpoint is only available to test-mode keys.' },
      { status: 400 }
    )
  }

  const user = await findUserById(partner.id, id)
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (user.kycStatus !== 'approved') {
    await approveUser(partner.id, user.id)
    await queueTestKycWebhook(partner.id, user.externalId, 'approved')
  }

  return NextResponse.json({
    livemode: false,
    id: user.id,
    externalId: user.externalId,
    kycStatus: 'approved',
    walletAddress: user.walletAddress,
    message: 'Approved. Re-call POST /api/v1/users with the same externalId to receive the wallet.',
  })
}
