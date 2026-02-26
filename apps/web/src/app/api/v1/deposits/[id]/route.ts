import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { depositRequests, mintTransactions, partnerUsers } from '@ntzs/db'

/**
 * GET /api/v1/deposits/:id — Check deposit status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult
  const { id: depositId } = await params

  const { db } = getDb()

  // Fetch deposit
  const [deposit] = await db
    .select({
      id: depositRequests.id,
      userId: depositRequests.userId,
      status: depositRequests.status,
      amountTzs: depositRequests.amountTzs,
      partnerId: depositRequests.partnerId,
      createdAt: depositRequests.createdAt,
    })
    .from(depositRequests)
    .where(eq(depositRequests.id, depositId))
    .limit(1)

  if (!deposit) {
    return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
  }

  // Verify the deposit belongs to this partner (either by partnerId or user ownership)
  if (deposit.partnerId && deposit.partnerId !== partner.id) {
    return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
  }

  if (!deposit.partnerId) {
    // Verify via user mapping
    const [mapping] = await db
      .select({ userId: partnerUsers.userId })
      .from(partnerUsers)
      .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, deposit.userId)))
      .limit(1)

    if (!mapping) {
      return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
    }
  }

  // Get mint transaction if exists
  let txHash: string | null = null
  if (deposit.status === 'minted' || deposit.status === 'mint_processing') {
    const [mintTx] = await db
      .select({ txHash: mintTransactions.txHash })
      .from(mintTransactions)
      .where(eq(mintTransactions.depositRequestId, depositId))
      .limit(1)

    txHash = mintTx?.txHash ?? null
  }

  return NextResponse.json({
    id: deposit.id,
    status: deposit.status,
    amountTzs: deposit.amountTzs,
    txHash,
    createdAt: deposit.createdAt,
  })
}
