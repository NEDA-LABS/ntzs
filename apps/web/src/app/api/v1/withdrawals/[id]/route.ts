import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { burnRequests, partnerUsers } from '@ntzs/db'

/**
 * GET /api/v1/withdrawals/:id — Check withdrawal status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult
  const { id: burnId } = await params

  const { db } = getDb()

  // Fetch burn request
  const [burn] = await db
    .select({
      id: burnRequests.id,
      userId: burnRequests.userId,
      status: burnRequests.status,
      amountTzs: burnRequests.amountTzs,
      txHash: burnRequests.txHash,
      payoutStatus: burnRequests.payoutStatus,
      payoutError: burnRequests.payoutError,
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

  return NextResponse.json({
    id: burn.id,
    status: burn.status,
    amountTzs: burn.amountTzs,
    txHash: burn.txHash,
    payoutStatus: burn.payoutStatus || 'pending',
    payoutError: burn.payoutError,
    createdAt: burn.createdAt,
  })
}
