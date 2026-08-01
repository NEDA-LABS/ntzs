import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { isTestMode, testGetWithdrawal } from '@/lib/testmode'
import { authenticatePartner } from '@/lib/waas/auth'
import { netPayoutTzs } from '@/lib/payouts/payout-math'
import { railLabel } from '@/lib/psp/selcom-fees'
import { burnRequests, partnerUsers } from '@ntzs/db'

/**
 * GET /api/v1/withdrawals/:id — Check withdrawal status
 *
 * Carries the payout confirmation details (rail, reference, net amount) so a
 * partner app can notify the withdrawing USER with the substance of the PSP's
 * confirmation — the PSP's own SMS goes only to the corporate account.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult
  const { id: burnId } = await params

  if (isTestMode(partner)) return testGetWithdrawal(partner, burnId)

  const { db } = getDb()

  // Fetch burn request
  const [burn] = await db
    .select({
      id: burnRequests.id,
      userId: burnRequests.userId,
      status: burnRequests.status,
      amountTzs: burnRequests.amountTzs,
      platformFeeTzs: burnRequests.platformFeeTzs,
      nedaFeeTzs: burnRequests.nedaFeeTzs,
      pspFeeTzs: burnRequests.pspFeeTzs,
      recipientPhone: burnRequests.recipientPhone,
      txHash: burnRequests.txHash,
      payoutStatus: burnRequests.payoutStatus,
      payoutError: burnRequests.payoutError,
      payoutProvider: burnRequests.payoutProvider,
      payoutReference: burnRequests.payoutReference,
      createdAt: burnRequests.createdAt,
    })
    .from(burnRequests)
    .where(eq(burnRequests.id, burnId))
    .limit(1)

  if (!burn) {
    return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 })
  }

  // Verify user belongs to this partner
  const [mapping] = await db
    .select({ userId: partnerUsers.userId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, burn.userId)))
    .limit(1)

  if (!mapping) {
    return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 })
  }

  // Net the recipient receives — backs out the fees this row was priced with.
  const receiveAmountTzs = netPayoutTzs(burn)

  const confirmationMessage =
    burn.payoutStatus === 'completed' && burn.payoutReference
      ? `TZS ${receiveAmountTzs.toLocaleString('en-US')} sent to ${burn.recipientPhone ?? 'the recipient'} via ${railLabel(burn.payoutProvider)} — ref ${burn.payoutReference}.`
      : null

  return NextResponse.json({
    id: burn.id,
    status: burn.status,
    amountTzs: burn.amountTzs,
    receiveAmountTzs,
    recipientPhone: burn.recipientPhone,
    txHash: burn.txHash,
    payoutStatus: burn.payoutStatus ?? null,
    payoutError: burn.payoutError,
    payoutRail: burn.payoutProvider ?? null,
    payoutReference: burn.payoutReference ?? null,
    confirmationMessage,
    createdAt: burn.createdAt,
  })
}
