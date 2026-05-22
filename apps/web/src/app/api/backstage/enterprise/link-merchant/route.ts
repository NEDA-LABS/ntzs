import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseLoanAgreements, merchantAccounts } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'

export async function POST(req: NextRequest) {
  try { await requireAnyRole(['super_admin', 'platform_compliance']) } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    enterpriseAccountId: string
    merchantId: string
    lenderSplitPct: number
    principalTzs?: number
  }

  const { enterpriseAccountId, merchantId, lenderSplitPct, principalTzs } = body

  if (!enterpriseAccountId || !merchantId) {
    return NextResponse.json({ error: 'enterpriseAccountId and merchantId are required' }, { status: 400 })
  }

  if (typeof lenderSplitPct !== 'number' || lenderSplitPct < 0 || lenderSplitPct > 95) {
    return NextResponse.json({ error: 'lenderSplitPct must be 0–95' }, { status: 400 })
  }

  const [enterprise] = await db
    .select({ id: enterpriseAccounts.id, partnerId: enterpriseAccounts.partnerId, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(and(eq(enterpriseAccounts.id, enterpriseAccountId), eq(enterpriseAccounts.isActive, true)))
    .limit(1)

  if (!enterprise) return NextResponse.json({ error: 'Enterprise account not found or inactive' }, { status: 404 })
  if (enterprise.type !== 'capital_lender') return NextResponse.json({ error: 'Only capital_lender accounts can be linked as lenders' }, { status: 400 })
  if (!enterprise.partnerId) return NextResponse.json({ error: 'Enterprise account has no linked partner' }, { status: 400 })

  const [merchant] = await db
    .select({ id: merchantAccounts.id, settlePct: merchantAccounts.settlePct })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Merchant not found' }, { status: 404 })

  if (lenderSplitPct + merchant.settlePct > 99) {
    return NextResponse.json({
      error: `lenderSplitPct (${lenderSplitPct}) + settlePct (${merchant.settlePct}) exceeds 99%`,
    }, { status: 400 })
  }

  await db
    .update(merchantAccounts)
    .set({
      lenderPartnerId: enterprise.partnerId,
      lenderSplitPct,
      updatedAt: new Date(),
    })
    .where(eq(merchantAccounts.id, merchantId))

  // Create loan agreement if principalTzs provided
  if (principalTzs && principalTzs > 0) {
    await db.insert(enterpriseLoanAgreements).values({
      partnerId: enterprise.partnerId,
      merchantId,
      principalTzs,
    })
  }

  return NextResponse.json({ ok: true })
}
