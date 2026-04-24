import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { partners } from '@ntzs/db'
import { signSessionToken, PARTNER_SESSION_COOKIE, PARTNER_SESSION_TTL_MS } from '@/lib/waas/auth'

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':')
  if (!salt || !hash) return false
  let derivedKey: Buffer
  try {
    derivedKey = crypto.scryptSync(password, salt, 64)
  } catch {
    return false
  }
  const stored = Buffer.from(hash, 'hex')
  if (stored.length !== derivedKey.length) return false
  return crypto.timingSafeEqual(stored, derivedKey)
}

/**
 * POST /api/v1/partners/login — Authenticate partner and return session token
 */
export async function POST(request: NextRequest) {
  let body: { email: string; password: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { email, password } = body

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }

  const { db } = getDb()

  const [partner] = await db
    .select({
      id: partners.id,
      name: partners.name,
      passwordHash: partners.passwordHash,
      isActive: partners.isActive,
    })
    .from(partners)
    .where(eq(partners.email, email))
    .limit(1)

  if (!partner || !partner.passwordHash) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  if (!partner.isActive) {
    return NextResponse.json({ error: 'Account is deactivated' }, { status: 403 })
  }

  if (!verifyPassword(password, partner.passwordHash)) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const token = signSessionToken(partner.id)

  const response = NextResponse.json({
    partnerId: partner.id,
    name: partner.name,
  })

  response.cookies.set(PARTNER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(PARTNER_SESSION_TTL_MS / 1000),
  })

  return response
}
