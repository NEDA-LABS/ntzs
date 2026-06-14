import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/merchant/db'
import {
  merchantAccounts,
  enterpriseAccounts,
  enterpriseMerchantApplications,
} from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { requireServiceKey } from '@/lib/service-auth'

/**
 * POST /api/v1/biashara/financing/invites/[id]/respond  (NEDApay service layer)
 * Merchant accepts/declines a lender's financing invite. Body: { action }.
 * Headers: x-service-key, x-merchant-id.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })

  const { id } = await params

  const [app] = await db
    .select()
    .from(enterpriseMerchantApplications)
    .where(
      and(
        eq(enterpriseMerchantApplications.id, id),
        eq(enterpriseMerchantApplications.merchantId, merchantId),
        eq(enterpriseMerchantApplications.direction, 'invite'),
        eq(enterpriseMerchantApplications.status, 'pending'),
      ),
    )
    .limit(1)

  if (!app) return NextResponse.json({ error: 'Invite not found or already resolved' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
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
      .where(eq(merchantAccounts.id, merchantId))

    await tx
      .update(enterpriseMerchantApplications)
      .set({ status: 'accepted', respondedAt: now })
      .where(eq(enterpriseMerchantApplications.id, id))
  })

  return NextResponse.json({ ok: true, status: 'accepted' })
}
