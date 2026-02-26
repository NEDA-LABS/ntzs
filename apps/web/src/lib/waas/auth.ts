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
 * Verify a partner session token and return the partner ID if valid
 */
export function verifySessionToken(token: string): string | null {
  const secret = process.env.APP_SECRET || 'dev-secret-do-not-use'
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, sig] = parts
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded!).digest('base64url')

  if (sig!.length !== expectedSig.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig!, 'utf8'), Buffer.from(expectedSig, 'utf8'))) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    if (payload.exp && payload.exp < Date.now()) return null
    return payload.pid || null
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
