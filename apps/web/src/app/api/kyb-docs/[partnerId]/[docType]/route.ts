import { NextRequest, NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { verifySessionToken } from '@/lib/waas/auth'
import { getCurrentDbUser } from '@/lib/auth/rbac'
import { partnerKyb } from '@ntzs/db'

const DOC_COLUMNS = {
  cert_of_incorporation: 'certOfIncorporationUrl',
  regulatory_license: 'regulatoryLicenseUrl',
  aml_policy: 'amlPolicyUrl',
} as const

type DocType = keyof typeof DOC_COLUMNS

/**
 * GET /api/kyb-docs/:partnerId/:docType — authenticated download for KYB
 * compliance documents. Blobs live in a PRIVATE store (no public URLs);
 * this route is the only read path, and it authorizes first:
 *   - the partner themselves (`self` or their own id, via partner session)
 *   - backstage staff (any non-end_user role)
 * The blob is streamed through with the store token server-side — the
 * private URL itself is never exposed to a browser.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ partnerId: string; docType: string }> }
) {
  const { partnerId: partnerIdParam, docType } = await params
  if (!(docType in DOC_COLUMNS)) {
    return NextResponse.json({ error: 'Unknown document type' }, { status: 404 })
  }

  const token =
    request.cookies.get('partner_session')?.value ||
    (request.headers.get('authorization')?.startsWith('Bearer ')
      ? request.headers.get('authorization')!.slice(7)
      : null)
  const sessionPartnerId = token ? verifySessionToken(token) : null

  let partnerId = partnerIdParam
  if (partnerIdParam === 'self') {
    if (!sessionPartnerId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    partnerId = sessionPartnerId
  } else if (sessionPartnerId !== partnerIdParam) {
    const staff = await getCurrentDbUser().catch(() => null)
    if (!staff || staff.role === 'end_user') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
  }

  const { db } = getDb()
  const [row] = await db.select().from(partnerKyb).where(eq(partnerKyb.partnerId, partnerId)).limit(1)
  const url = row?.[DOC_COLUMNS[docType as DocType]] ?? null
  if (!url) return NextResponse.json({ error: 'Document not uploaded' }, { status: 404 })

  const result = await get(url, { access: 'private' }).catch((err) => {
    console.error('[kyb-docs] blob fetch failed:', err instanceof Error ? err.message : err)
    return null
  })
  if (!result || !result.stream) {
    return NextResponse.json({ error: 'Document unavailable' }, { status: 502 })
  }

  const meta = result.blob as { contentType?: string }
  return new Response(result.stream as unknown as BodyInit, {
    headers: {
      'Content-Type': meta.contentType ?? 'application/octet-stream',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
    },
  })
}
