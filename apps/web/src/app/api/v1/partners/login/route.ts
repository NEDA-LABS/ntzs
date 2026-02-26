import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { partners } from '@ntzs/db'

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':')
  if (!salt || !hash) return false
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derivedKey, 'hex'))
}

function signSessionToken(partnerId: string): string {
  const secret = process.env.APP_SECRET || 'dev-secret-do-not-use'
  const payload = JSON.stringify({ pid: partnerId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })
  const encoded = Buffer.from(payload).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
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

  return NextResponse.json({
    token,
    partnerId: partner.id,
    name: partner.name,
  })
}
