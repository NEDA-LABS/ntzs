/**
 * WaaS Partner API Key Authentication
 * Extracts Bearer token from Authorization header, hashes it,
 * and looks up the partner in the DB.
 */

import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { partners } from '@ntzs/db'

export interface AuthenticatedPartner {
  id: string
  name: string
  webhookUrl: string | null
  webhookSecret: string | null
  encryptedHdSeed: string | null
  nextWalletIndex: number
}

/**
 * Hash an API key using SHA-256 for storage/lookup
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex')
}

/**
 * Resolve the HMAC secret used to sign partner sessions.
 * Fails closed when APP_SECRET is missing / too short to prevent any
 * deployment from silently falling back to a guessable default.
 */
function getAppSecret(): string {
  const secret = process.env.APP_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'APP_SECRET is not configured (must be set to a random string of at least 32 characters)'
    )
  }
  return secret
}

export const PARTNER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PARTNER_SESSION_COOKIE = 'partner_session'

/**
 * Sign a partner session token. `exp` is always included.
 */
export function signSessionToken(partnerId: string, ttlMs: number = PARTNER_SESSION_TTL_MS): string {
  const secret = getAppSecret()
  const payload = JSON.stringify({ pid: partnerId, exp: Date.now() + ttlMs })
  const encoded = Buffer.from(payload).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

/**
 * Verify a partner session token and return the partner ID if valid.
 * Requires a numeric `exp` claim — tokens without one are rejected.
 */
export function verifySessionToken(token: string): string | null {
  let secret: string
  try {
    secret = getAppSecret()
  } catch {
    // Fail closed: if the server is misconfigured, no session is valid.
    return null
  }

  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, sig] = parts
  if (!encoded || !sig) return null

  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
  const sigBuf = Buffer.from(sig, 'utf8')
  const expBuf = Buffer.from(expectedSig, 'utf8')
  if (sigBuf.length !== expBuf.length) return null
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (typeof payload.pid !== 'string' || !payload.pid) return null
    return payload.pid
  } catch {
    return null
  }
}

/**
 * Verify a partner session and return the partner info if valid
 */
export async function verifyPartnerSession(token: string): Promise<AuthenticatedPartner | null> {
  const partnerId = verifySessionToken(token)
  if (!partnerId) return null

  const { db } = getDb()
  const [partner] = await db
    .select({
      id: partners.id,
      name: partners.name,
      webhookUrl: partners.webhookUrl,
      webhookSecret: partners.webhookSecret,
      encryptedHdSeed: partners.encryptedHdSeed,
      nextWalletIndex: partners.nextWalletIndex,
      isActive: partners.isActive,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner || !partner.isActive) return null

  return {
    id: partner.id,
    name: partner.name,
    webhookUrl: partner.webhookUrl,
    webhookSecret: partner.webhookSecret,
    encryptedHdSeed: partner.encryptedHdSeed,
    nextWalletIndex: partner.nextWalletIndex,
  }
}

/**
 * Authenticate a partner from the request's Authorization header.
 * Returns the partner if valid, or a NextResponse error.
 */
export async function authenticatePartner(
  request: NextRequest
): Promise<{ partner: AuthenticatedPartner } | { error: NextResponse }> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: NextResponse.json(
        { error: 'Missing or invalid Authorization header. Expected: Bearer <api_key>' },
        { status: 401 }
      ),
    }
  }

  const apiKey = authHeader.slice(7) // Remove "Bearer "
  if (!apiKey) {
    return {
      error: NextResponse.json({ error: 'Empty API key' }, { status: 401 }),
    }
  }

  const keyHash = hashApiKey(apiKey)
  const { db } = getDb()

  const [partner] = await db
    .select({
      id: partners.id,
      name: partners.name,
      webhookUrl: partners.webhookUrl,
      webhookSecret: partners.webhookSecret,
      encryptedHdSeed: partners.encryptedHdSeed,
      nextWalletIndex: partners.nextWalletIndex,
      isActive: partners.isActive,
    })
    .from(partners)
    .where(eq(partners.apiKeyHash, keyHash))
    .limit(1)

  if (!partner) {
    return {
      error: NextResponse.json({ error: 'Invalid API key' }, { status: 401 }),
    }
  }

  if (!partner.isActive) {
    return {
      error: NextResponse.json({ error: 'Partner account is deactivated' }, { status: 403 }),
    }
  }

  return {
    partner: {
      id: partner.id,
      name: partner.name,
      webhookUrl: partner.webhookUrl,
      webhookSecret: partner.webhookSecret,
      encryptedHdSeed: partner.encryptedHdSeed,
      nextWalletIndex: partner.nextWalletIndex,
    },
  }
}
