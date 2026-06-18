import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { authenticatePartner, verifyPartnerSession, type AuthenticatedPartner } from '@/lib/waas/auth'
import { getDb } from '@/lib/db'
import { partners, partnerKyb } from '@ntzs/db'
import { hasCapability, capabilityError } from '@/lib/platform/capabilities'

/**
 * Authenticate a partner for the Ramp API. Accepts EITHER a Bearer API key
 * (external partners) OR a partner session cookie (the developer dashboard
 * driving the Ramp console). Then requires the `ramp` capability + approved KYB
 * — the ramp endpoints move real money (USDC ⇄ mobile money).
 */
export async function requireRampPartner(
  req: NextRequest,
): Promise<{ partner: AuthenticatedPartner } | { error: NextResponse }> {
  // ── Auth: Bearer key OR partner session cookie ─────────────────────────────
  let partner: AuthenticatedPartner | null = null
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const r = await authenticatePartner(req)
    if ('error' in r) return r
    partner = r.partner
  } else {
    const token = req.cookies.get('partner_session')?.value
    partner = token ? await verifyPartnerSession(token) : null
  }
  if (!partner) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  const { db } = getDb()

  // ── Capability gate (`ramp`) ───────────────────────────────────────────────
  const [row] = await db
    .select({ capabilities: partners.capabilities })
    .from(partners)
    .where(eq(partners.id, partner.id))
    .limit(1)
  if (!hasCapability(row?.capabilities ?? null, 'ramp')) {
    return { error: capabilityError('ramp') }
  }

  // ── KYB gate ───────────────────────────────────────────────────────────────
  const [kyb] = await db
    .select({ status: partnerKyb.status })
    .from(partnerKyb)
    .where(eq(partnerKyb.partnerId, partner.id))
    .limit(1)
  if (!kyb || kyb.status !== 'approved') {
    return {
      error: NextResponse.json(
        { error: 'KYB approval required to use the Ramp API. Contact NEDApay to complete verification.' },
        { status: 403 },
      ),
    }
  }

  return { partner }
}
