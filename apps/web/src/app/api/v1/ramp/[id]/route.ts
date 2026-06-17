import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { rampSettlements } from '@ntzs/db'
import { requireRampPartner } from '@/lib/ramp/auth'

export const runtime = 'nodejs'

/**
 * GET /api/v1/ramp/[id] — status of one ramp settlement (scoped to the partner).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRampPartner(req)
  if ('error' in auth) return auth.error

  const { id } = await params
  const { db } = getDb()

  const [s] = await db
    .select()
    .from(rampSettlements)
    .where(and(eq(rampSettlements.id, id), eq(rampSettlements.partnerId, auth.partner.id)))
    .limit(1)

  if (!s) return NextResponse.json({ error: 'Settlement not found' }, { status: 404 })

  return NextResponse.json({
    settlementId: s.id,
    direction: s.direction,
    status: s.status,
    usdcAmount: Number(s.usdcAmount),
    tzsAmount: s.tzsAmount,
    feeTzs: s.feeTzs,
    rateUsdTzs: Number(s.rateUsdTzs),
    recipientPhone: s.recipientPhone,
    destinationAddress: s.destinationAddress,
    swapInTxHash: s.swapInTxHash,
    swapOutTxHash: s.swapOutTxHash,
    pspReference: s.pspReference,
    error: s.error,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  })
}
