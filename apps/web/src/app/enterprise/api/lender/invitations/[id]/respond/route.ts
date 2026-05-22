import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import {
  enterpriseAccounts,
  merchantAccounts,
  enterpriseMerchantApplications,
  enterpriseLoanAgreements,
} from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

  const [app] = await db
    .select()
    .from(enterpriseMerchantApplications)
    .where(
      and(
        eq(enterpriseMerchantApplications.id, id),
        eq(enterpriseMerchantApplications.enterpriseId, session.enterpriseId),
        eq(enterpriseMerchantApplications.status, 'pending')
      )
    )
    .limit(1)

  if (!app) return NextResponse.json({ error: 'Application not found or already resolved' }, { status: 404 })
  if (app.direction !== 'application') {
    return NextResponse.json({ error: 'This endpoint is for responding to merchant applications' }, { status: 400 })
  }

  const body = await req.json()
  const { action, principalTzs, interestRatePct } = body

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

  // Accept: link the merchant
  const splitPct = app.proposedSplitPct ?? 30

  await db.transaction(async (tx) => {
    await tx
      .update(merchantAccounts)
      .set({
        lenderPartnerId: account.partnerId,
        lenderSplitPct: splitPct,
        lenderControlsSettlement: true,
        updatedAt: now,
      })
      .where(eq(merchantAccounts.id, app.merchantId))

    await tx
      .update(enterpriseMerchantApplications)
      .set({ status: 'accepted', respondedAt: now })
      .where(eq(enterpriseMerchantApplications.id, id))

    if (principalTzs && Number(principalTzs) > 0) {
      const principal = Math.trunc(Number(principalTzs))
      const ratePct = Number(interestRatePct ?? 0)
      const interestTzs = Math.floor(principal * ratePct / 100)
      await tx
        .insert(enterpriseLoanAgreements)
        .values({
          partnerId: account.partnerId!,
          merchantId: app.merchantId,
          principalTzs: principal,
          interestRatePct: ratePct,
          interestTzs,
          totalOwedTzs: principal + interestTzs,
        })
    }
  })

  return NextResponse.json({ ok: true, status: 'accepted' })
}
