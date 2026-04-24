import { NextResponse } from 'next/server'

import { PARTNER_SESSION_COOKIE } from '@/lib/waas/auth'

/**
 * POST /api/v1/partners/logout — Clear the partner_session cookie.
 * Safe to call unauthenticated; always returns success.
 */
export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.set(PARTNER_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
