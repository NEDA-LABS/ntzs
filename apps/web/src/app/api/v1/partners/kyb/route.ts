import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { partnerKyb } from '@ntzs/db'
import { verifySessionToken } from '@/lib/waas/auth'

function requireAuth(request: NextRequest): string | null {
  const token =
    request.cookies.get('partner_session')?.value ||
    (request.headers.get('authorization')?.startsWith('Bearer ')
      ? request.headers.get('authorization')!.slice(7)
      : null)
  return token ? verifySessionToken(token) : null
}

export async function GET(request: NextRequest) {
  const partnerId = requireAuth(request)
  if (!partnerId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { db } = getDb()

  const [kyb] = await db
    .select()
    .from(partnerKyb)
    .where(eq(partnerKyb.partnerId, partnerId))
    .limit(1)

  return NextResponse.json({ kyb: kyb ?? null })
}

export async function POST(request: NextRequest) {
  const partnerId = requireAuth(request)
  if (!partnerId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json() as Record<string, string>

  const allowed = [
    'businessLegalName', 'registrationNumber', 'registeredAddress',
    'authorizedRepName', 'authorizedRepTitle', 'authorizedRepEmail',
    'licenseType', 'licenseNumber', 'issuingAuthority', 'jurisdiction',
    'certOfIncorporationUrl', 'regulatoryLicenseUrl', 'amlPolicyUrl',
  ] as const
  type AllowedKey = typeof allowed[number]
  const update: Partial<Record<AllowedKey, string>> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = String(body[key])
  }

  const { db } = getDb()

  const [existing] = await db
    .select({ id: partnerKyb.id, status: partnerKyb.status })
    .from(partnerKyb)
    .where(eq(partnerKyb.partnerId, partnerId))
    .limit(1)

  const isSubmit = body.submit === 'true'
  const now = new Date()

  if (existing) {
    if (['approved', 'under_review'].includes(existing.status)) {
      return NextResponse.json({ error: 'KYB is locked for review — contact support to make changes' }, { status: 409 })
    }

    const [updated] = await db
      .update(partnerKyb)
      .set({
        ...update,
        ...(isSubmit ? { status: 'submitted', submittedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(partnerKyb.partnerId, partnerId))
      .returning()

    return NextResponse.json({ kyb: updated })
  }

  const [created] = await db
    .insert(partnerKyb)
    .values({
      partnerId,
      ...update,
      ...(isSubmit ? { status: 'submitted', submittedAt: now } : { status: 'not_started' }),
    })
    .returning()

  return NextResponse.json({ kyb: created }, { status: 201 })
}
