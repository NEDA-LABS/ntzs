import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/enterprise/db'
import { partnerKyb } from '@ntzs/db'
import { requireAnyRole } from '@/lib/auth/rbac'

export async function POST(request: NextRequest) {
  let reviewer: { email: string }
  try {
    reviewer = await requireAnyRole(['super_admin', 'platform_compliance'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { partnerId: string; decision: 'approved' | 'rejected'; notes?: string }
  const { partnerId, decision, notes } = body

  if (!partnerId || !['approved', 'rejected'].includes(decision)) {
    return NextResponse.json({ error: 'partnerId and decision (approved|rejected) are required' }, { status: 400 })
  }

  const now = new Date()

  const [updated] = await db
    .update(partnerKyb)
    .set({
      status: decision,
      reviewNotes: notes ?? null,
      reviewedAt: now,
      reviewedBy: reviewer.email,
      updatedAt: now,
    })
    .where(eq(partnerKyb.partnerId, partnerId))
    .returning()

  if (!updated) return NextResponse.json({ error: 'KYB record not found for this partner' }, { status: 404 })

  return NextResponse.json({ kyb: updated })
}
