import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { hashApiKey } from '@/lib/waas/auth'
import { partners } from '@ntzs/db'
import { writeAuditLog } from '@/lib/audit'

/**
 * POST /api/v1/partners/signup — Create a new partner account and return an API key
 */
export async function POST(request: NextRequest) {
  let body: { businessName: string; email: string; password: string; webhookUrl?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { businessName, email, password, webhookUrl } = body

  if (!businessName || !email || !password) {
    return NextResponse.json(
      { error: 'businessName, email, and password are required' },
      { status: 400 }
    )
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    )
  }

  const { db } = getDb()

  // Check if email already exists
  const [existing] = await db
    .select({ id: partners.id })
    .from(partners)
    .where(eq(partners.email, email))
    .limit(1)

  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email already exists' },
      { status: 409 }
    )
  }

  // Generate API key with environment-aware prefix
  const isProduction = process.env.NODE_ENV === 'production'
  const prefix = isProduction ? 'ntzs_live_' : 'ntzs_test_'
  const rawKey = crypto.randomBytes(20).toString('hex')
  const apiKey = `${prefix}${rawKey}`
  const apiKeyHash = hashApiKey(apiKey)
  const apiKeyPrefix = apiKey.slice(0, 14)

  // Hash password with scrypt
  const salt = crypto.randomBytes(16).toString('hex')
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex')
  const passwordHash = `${salt}:${derivedKey}`

  // Generate webhook secret
  const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`

  const [partner] = await db
    .insert(partners)
    .values({
      name: businessName,
      email,
      passwordHash,
      apiKeyHash,
      apiKeyPrefix,
      webhookUrl: webhookUrl || null,
      webhookSecret,
      isActive: true,
    })
    .returning({ id: partners.id })

  if (!partner) {
    return NextResponse.json({ error: 'Failed to create partner' }, { status: 500 })
  }

  console.log('[partners/signup] Partner created:', { id: partner.id, name: businessName })
  await writeAuditLog('partner.created', 'partner', partner.id, { name: businessName, email, apiKeyPrefix })

  return NextResponse.json(
    {
      partnerId: partner.id,
      apiKey,
      webhookSecret,
    },
    { status: 201 }
  )
}
