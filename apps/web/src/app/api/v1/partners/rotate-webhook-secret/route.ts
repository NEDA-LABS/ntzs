import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { verifyPartnerSession, generateWebhookSecret } from '@/lib/waas/auth'
import { writeAuditLog } from '@/lib/audit'
import { partners } from '@ntzs/db'

/**
 * POST /api/v1/partners/rotate-webhook-secret
 *
 * Mint a fresh webhook signing secret for the authenticated partner and return
 * it once. Also the path to CREATE a secret for the rare legacy partner that
 * has none. Signatures made with the previous secret stop validating the moment
 * this returns, so the partner must update their endpoint. The new value is
 * never logged.
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

  const webhookSecret = generateWebhookSecret()

  const { db } = getDb()
  await db
    .update(partners)
    .set({ webhookSecret, updatedAt: new Date() })
    .where(eq(partners.id, partner.id))

  await writeAuditLog('partner.webhook_secret.rotated', 'partner', partner.id)
  console.log('[partners/rotate-webhook-secret] rotated for partner:', partner.id)

  return NextResponse.json({
    success: true,
    webhookSecret,
    message:
      'Webhook signing secret rotated. Update your endpoint to verify with the new secret — signatures from the old secret will no longer validate.',
  })
}
