import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { verifyPartnerSession } from '@/lib/waas/auth'
import { partners } from '@ntzs/db'

/**
 * PUT /api/v1/partners/webhook — Update webhook URL for authenticated partner
 */
export async function PUT(request: NextRequest) {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('partner_session')?.value

  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const partner = await verifyPartnerSession(sessionToken)
  if (!partner) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  let body: { webhookUrl: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { webhookUrl } = body

  // Validate URL format if provided
  if (webhookUrl) {
    try {
      const url = new URL(webhookUrl)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return NextResponse.json({ error: 'Webhook URL must use HTTP or HTTPS' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid webhook URL format' }, { status: 400 })
    }
  }

  const { db } = getDb()

  await db
    .update(partners)
    .set({
      webhookUrl: webhookUrl || null,
      updatedAt: new Date(),
    })
    .where(eq(partners.id, partner.id))

  console.log('[partners/webhook] Webhook URL updated for partner:', partner.id)

  return NextResponse.json({
    success: true,
    webhookUrl: webhookUrl || null,
  })
}
