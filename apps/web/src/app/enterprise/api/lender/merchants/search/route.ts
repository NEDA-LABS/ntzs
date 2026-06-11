import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts } from '@ntzs/db'
import { eq, and, or, ilike, isNull } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

/**
 * GET /enterprise/api/lender/merchants/search?q=...
 *
 * Lender-scoped merchant search for the invite flow. Returns existing NEDApay
 * merchants that are INVITABLE — i.e. active and not already linked to a lender.
 *
 * (The invite UI previously hit /backstage/api/merchants, which is gated to
 * admin roles and so 401'd for lender sessions — lenders could never find a
 * merchant to invite.)
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [account] = await db
    .select({ partnerId: enterpriseAccounts.partnerId, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account?.partnerId || account.type !== 'capital_lender') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ merchants: [] })

  const rows = await db
    .select({
      id: merchantAccounts.id,
      businessName: merchantAccounts.businessName,
      handle: merchantAccounts.handle,
      email: merchantAccounts.email,
      settlePct: merchantAccounts.settlePct,
      lenderPartnerId: merchantAccounts.lenderPartnerId,
    })
    .from(merchantAccounts)
    .where(
      and(
        isNull(merchantAccounts.lenderPartnerId), // only merchants not yet under a lender
        eq(merchantAccounts.isActive, true),
        or(
          ilike(merchantAccounts.businessName, `%${q}%`),
          ilike(merchantAccounts.handle, `%${q}%`),
          ilike(merchantAccounts.email, `%${q}%`),
        ),
      ),
    )
    .limit(20)

  return NextResponse.json({ merchants: rows })
}
