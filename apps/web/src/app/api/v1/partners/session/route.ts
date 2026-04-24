import { NextRequest, NextResponse } from 'next/server'

import { PARTNER_SESSION_COOKIE, verifyPartnerSession } from '@/lib/waas/auth'

/**
 * GET /api/v1/partners/session — Lightweight session check for the dashboard shell.
 * Returns { authenticated: true, partnerId, name } when the HttpOnly
 * session cookie is valid; 401 otherwise. Never returns the token.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(PARTNER_SESSION_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  const partner = await verifyPartnerSession(token)
  if (!partner) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  return NextResponse.json({
    authenticated: true,
    partnerId: partner.id,
    name: partner.name,
  })
}
