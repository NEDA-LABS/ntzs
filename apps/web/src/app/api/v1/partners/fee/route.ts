import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { partners } from '@ntzs/db'
import { writeAuditLog } from '@/lib/audit'
import { verifyPartnerSession } from '@/lib/waas/auth'

/**
 * PUT /api/v1/partners/fee — Update partner fee percentage
 */
export async function PUT(request: NextRequest) {
  const cookieToken = request.cookies.get('partner_session')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = cookieToken || bearerToken

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const partnerInfo = await verifyPartnerSession(token)
  if (!partnerInfo) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
  }
  const partnerId = partnerInfo.id

  let body: { feePercent: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { feePercent } = body

  if (typeof feePercent !== 'number' || feePercent < 0 || feePercent > 100) {
    return NextResponse.json({ error: 'feePercent must be a number between 0 and 100' }, { status: 400 })
  }

  const { db } = getDb()

  await db
    .update(partners)
    .set({ feePercent: String(feePercent), updatedAt: new Date() })
    .where(eq(partners.id, partnerId))

  await writeAuditLog('partner.fee_updated', 'partner', partnerId, { feePercent })

  return NextResponse.json({ feePercent })
}
