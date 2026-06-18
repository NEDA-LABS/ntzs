import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { auditLogs } from '@ntzs/db'
import { verifySessionToken } from '@/lib/waas/auth'
import { CAPABILITIES, type Capability } from '@/lib/platform/capabilities'

/**
 * POST /api/v1/partners/capabilities/request
 * Body: { capability }
 *
 * A partner asks ops to enable a capability they don't have yet. v1: records an
 * audit entry for ops to action via backstage (then they set it on the partner).
 * Session-authed (the developer dashboard).
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('partner_session')?.value
  const partnerId = token ? verifySessionToken(token) : null
  if (!partnerId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: { capability?: string; note?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const cap = body.capability
  if (!cap || !(cap in CAPABILITIES)) {
    return NextResponse.json({ error: `Unknown capability. Valid: ${Object.keys(CAPABILITIES).join(', ')}` }, { status: 400 })
  }

  const { db } = getDb()
  await db.insert(auditLogs).values({
    action: 'partner_capability_requested',
    entityType: 'partner',
    entityId: partnerId,
    metadata: { capability: cap as Capability, kybRequired: CAPABILITIES[cap as Capability].kybRequired, note: body.note ?? null },
  })

  return NextResponse.json({
    ok: true,
    message: `Request to enable '${CAPABILITIES[cap as Capability].label}' received — our team will review and enable it${CAPABILITIES[cap as Capability].kybRequired ? ' once KYB is approved' : ''}.`,
  })
}
