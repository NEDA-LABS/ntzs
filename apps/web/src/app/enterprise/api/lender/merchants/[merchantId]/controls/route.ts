import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params

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

  const [merchant] = await db
    .select({ id: merchantAccounts.id, settlePct: merchantAccounts.settlePct, lenderPartnerId: merchantAccounts.lenderPartnerId })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant || merchant.lenderPartnerId !== account.partnerId) {
    return NextResponse.json({ error: 'Merchant not linked to this lender' }, { status: 404 })
  }

  const body = await req.json()
  const updates: Record<string, unknown> = { updatedAt: new Date() }

  if (typeof body.lenderSplitPct === 'number') {
    const split = Math.trunc(body.lenderSplitPct)
    if (split < 0 || split + merchant.settlePct > 99) {
      return NextResponse.json({ error: `lenderSplitPct + settlePct must not exceed 99` }, { status: 400 })
    }
    updates.lenderSplitPct = split
  }

  if (typeof body.withdrawalLimitTzs === 'number') {
    const cap = Math.trunc(body.withdrawalLimitTzs)
    if (cap < 0) return NextResponse.json({ error: 'withdrawalLimitTzs must be >= 0' }, { status: 400 })
    updates.withdrawalLimitTzs = cap
  }

  if (typeof body.lenderControlsSettlement === 'boolean') {
    updates.lenderControlsSettlement = body.lenderControlsSettlement
  }

  await db.update(merchantAccounts).set(updates).where(eq(merchantAccounts.id, merchantId))

  return NextResponse.json({ ok: true })
}
