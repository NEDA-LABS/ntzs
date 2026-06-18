import { NextRequest, NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { rampSettlements } from '@ntzs/db'
import { requireRampPartner } from '@/lib/ramp/auth'

export const runtime = 'nodejs'

/**
 * GET /api/v1/ramp/settlements?limit=&offset=
 * Paginated list of the partner's ramp settlements (newest first).
 */
export async function GET(req: NextRequest) {
  const auth = await requireRampPartner(req)
  if ('error' in auth) return auth.error

  const sp = req.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 25), 1), 100)
  const offset = Math.max(Number(sp.get('offset') ?? 0), 0)

  const { db } = getDb()
  const rows = await db
    .select()
    .from(rampSettlements)
    .where(eq(rampSettlements.partnerId, auth.partner.id))
    .orderBy(desc(rampSettlements.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({
    settlements: rows.map((s) => ({
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
    })),
    limit,
    offset,
  })
}
