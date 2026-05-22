import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/merchant/db'
import {
  merchantAccounts,
  enterpriseAccounts,
  enterpriseMerchantApplications,
  enterpriseLoanAgreements,
} from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/merchant/auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [app] = await db
    .select()
    .from(enterpriseMerchantApplications)
    .where(
      and(
        eq(enterpriseMerchantApplications.id, id),
        eq(enterpriseMerchantApplications.merchantId, session.merchantId),
        eq(enterpriseMerchantApplications.direction, 'invite'),
        eq(enterpriseMerchantApplications.status, 'pending')
      )
    )
    .limit(1)

  if (!app) return NextResponse.json({ error: 'Invite not found or already resolved' }, { status: 404 })

  const body = await req.json()
  const { action } = body

  if (action !== 'accept' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "accept" or "reject"' }, { status: 400 })
  }

  const now = new Date()

  if (action === 'reject') {
    await db
      .update(enterpriseMerchantApplications)
      .set({ status: 'rejected', respondedAt: now })
      .where(eq(enterpriseMerchantApplications.id, id))
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  // Accept: look up lender's partnerId
  const [enterprise] = await db
    .select({ partnerId: enterpriseAccounts.partnerId })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, app.enterpriseId))
    .limit(1)

  if (!enterprise?.partnerId) {
    return NextResponse.json({ error: 'Lender has no partner linked' }, { status: 409 })
  }

  const splitPct = app.proposedSplitPct ?? 30

  await db.transaction(async (tx) => {
    await tx
      .update(merchantAccounts)
      .set({
        lenderPartnerId: enterprise.partnerId,
        lenderSplitPct: splitPct,
        lenderControlsSettlement: true,
        updatedAt: now,
      })
      .where(eq(merchantAccounts.id, session.merchantId))

    await tx
      .update(enterpriseMerchantApplications)
      .set({ status: 'accepted', respondedAt: now })
      .where(eq(enterpriseMerchantApplications.id, id))
  })

  return NextResponse.json({ ok: true, status: 'accepted' })
}
