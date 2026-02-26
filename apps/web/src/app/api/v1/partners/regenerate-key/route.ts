import crypto from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { hashApiKey, verifyPartnerSession } from '@/lib/waas/auth'
import { partners } from '@ntzs/db'

/**
 * POST /api/v1/partners/regenerate-key — Regenerate API key for authenticated partner
 * Returns the new API key (only shown once)
 */
export async function POST() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('partner_session')?.value

  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const partner = await verifyPartnerSession(sessionToken)
  if (!partner) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const { db } = getDb()

  // Generate new API key with environment-aware prefix
  const isProduction = process.env.NODE_ENV === 'production'
  const prefix = isProduction ? 'ntzs_live_' : 'ntzs_test_'
  const rawKey = crypto.randomBytes(20).toString('hex')
  const apiKey = `${prefix}${rawKey}`
  const apiKeyHash = hashApiKey(apiKey)
  const apiKeyPrefix = apiKey.slice(0, 14)

  // Update partner with new key
  await db
    .update(partners)
    .set({
      apiKeyHash,
      apiKeyPrefix,
      updatedAt: new Date(),
    })
    .where(eq(partners.id, partner.id))

  console.log('[partners/regenerate-key] API key regenerated for partner:', partner.id)

  return NextResponse.json({
    success: true,
    apiKey,
    apiKeyPrefix,
    message: 'API key regenerated successfully. Save this key now — it will not be shown again.',
  })
}
