import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { merchantId } = await params
  const { lenderSplitPct } = await req.json()

  if (typeof lenderSplitPct !== 'number' || lenderSplitPct < 0 || lenderSplitPct > 95) {
    return NextResponse.json({ error: 'lenderSplitPct must be 0–95' }, { status: 400 })
  }

  const [account] = await db
    .select({ partnerId: enterpriseAccounts.partnerId, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account?.partnerId || account.type !== 'capital_lender') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [merchant] = await db
    .select({ id: merchantAccounts.id, settlePct: merchantAccounts.settlePct })
    .from(merchantAccounts)
    .where(
      and(
        eq(merchantAccounts.id, merchantId),
        eq(merchantAccounts.lenderPartnerId, account.partnerId)
      )
    )
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Merchant not found' }, { status: 404 })

  if (lenderSplitPct + merchant.settlePct > 99) {
    return NextResponse.json(
      { error: `lenderSplitPct (${lenderSplitPct}) + settlePct (${merchant.settlePct}) must be ≤ 99` },
      { status: 400 }
    )
  }

  await db
    .update(merchantAccounts)
    .set({ lenderSplitPct, updatedAt: new Date() })
    .where(eq(merchantAccounts.id, merchantId))

  return NextResponse.json({ ok: true, lenderSplitPct })
}
