import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Validates the x-service-key header for service-to-service calls
 * (e.g. NEDApay → nTZS Biashara/Enterprise routes).
 *
 * Returns null when the key is valid, or a ready-to-return NextResponse
 * when it's missing/invalid — so callers can do:
 *
 *   const authError = requireServiceKey(req)
 *   if (authError) return authError
 */
export function requireServiceKey(req: NextRequest): NextResponse | null {
  const key = process.env.NTZS_SERVICE_KEY
  if (!key) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }

  const provided = req.headers.get('x-service-key') ?? ''

  // Hash both to a fixed-length digest so timingSafeEqual always gets equal-
  // length buffers and we don't leak the expected key's length.
  const expected = crypto.createHash('sha256').update(key).digest()
  const got = crypto.createHash('sha256').update(provided).digest()

  if (!crypto.timingSafeEqual(expected, got)) {
    return NextResponse.json({ error: 'Invalid service key' }, { status: 401 })
  }

  return null
}
