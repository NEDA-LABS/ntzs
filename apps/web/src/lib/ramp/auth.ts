import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { authenticatePartner, type AuthenticatedPartner } from '@/lib/waas/auth'
import { getDb } from '@/lib/db'
import { partnerKyb } from '@ntzs/db'

/**
 * Authenticate a partner for the Ramp API and require approved KYB. The ramp
 * product moves real money (USDC ⇄ mobile money), so no settlement may run for
 * a partner whose business verification isn't approved.
 */
export async function requireRampPartner(
  req: NextRequest,
): Promise<{ partner: AuthenticatedPartner } | { error: NextResponse }> {
  const authResult = await authenticatePartner(req)
  if ('error' in authResult) return authResult

  const { db } = getDb()
  const [kyb] = await db
    .select({ status: partnerKyb.status })
    .from(partnerKyb)
    .where(eq(partnerKyb.partnerId, authResult.partner.id))
    .limit(1)

  if (!kyb || kyb.status !== 'approved') {
    return {
      error: NextResponse.json(
        { error: 'KYB approval required to use the Ramp API. Contact NEDApay to complete verification.' },
        { status: 403 },
      ),
    }
  }

  return authResult
}
