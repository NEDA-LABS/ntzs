import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { merchantAccounts, enterpriseLoanAgreements, partners } from '@ntzs/db'
import { eq, ilike, or, isNull } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'

export async function GET(req: NextRequest) {
  try { await requireAnyRole(['super_admin', 'platform_compliance']) } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = req.nextUrl.searchParams.get('q')?.trim()

  const rows = await db
    .select({
      id: merchantAccounts.id,
      businessName: merchantAccounts.businessName,
      handle: merchantAccounts.handle,
      email: merchantAccounts.email,
      settlePct: merchantAccounts.settlePct,
      lenderPartnerId: merchantAccounts.lenderPartnerId,
      lenderSplitPct: merchantAccounts.lenderSplitPct,
      isActive: merchantAccounts.isActive,
    })
    .from(merchantAccounts)
    .where(
      q
        ? or(
            ilike(merchantAccounts.businessName, `%${q}%`),
            ilike(merchantAccounts.handle, `%${q}%`),
            ilike(merchantAccounts.email, `%${q}%`)
          )
        : undefined
    )
    .limit(50)

  return NextResponse.json({ merchants: rows })
}
