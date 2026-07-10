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

  const [current] = await db
    .select({
      status: partnerKyb.status,
      certOfIncorporationUrl: partnerKyb.certOfIncorporationUrl,
    })
    .from(partnerKyb)
    .where(eq(partnerKyb.partnerId, partnerId))
    .limit(1)

  if (!current) return NextResponse.json({ error: 'KYB record not found for this partner' }, { status: 404 })

  // Only cases the partner actually submitted are reviewable — a draft
  // ('not_started') can't be approved blind, and a decided case stays decided.
  if (!['submitted', 'under_review'].includes(current.status)) {
    return NextResponse.json(
      { error: `Only submitted cases can be reviewed (current status: ${current.status})` },
      { status: 409 }
    )
  }
  if (decision === 'approved' && !current.certOfIncorporationUrl) {
    return NextResponse.json(
      { error: 'Cannot approve without a certificate of incorporation on file' },
      { status: 400 }
    )
  }
  if (decision === 'rejected' && !notes?.trim()) {
    return NextResponse.json({ error: 'Rejection requires notes explaining the reason' }, { status: 400 })
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
