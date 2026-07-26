import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { verifyPartnerSession } from '@/lib/waas/auth'
import { writeAuditLog } from '@/lib/audit'

/**
 * POST /api/v1/partners/reveal-webhook-secret
 *
 * Returns the authenticated partner's webhook signing secret (`whsec_…`) so they
 * can verify the `X-Webhook-Signature` HMAC on events we send. The secret is
 * stored in plaintext (the server needs it to sign), but is deliberately kept
 * OUT of the dashboard GET payload — it is only ever returned here, on an
 * explicit, session-authenticated action, and the value is never logged.
 *
 * POST (not GET) so the secret cannot land in browser history, prefetch, or a
 * cached response.
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

  await writeAuditLog('partner.webhook_secret.revealed', 'partner', partner.id)

  return NextResponse.json({ webhookSecret: partner.webhookSecret ?? null })
}
