import { NextResponse } from 'next/server'
import { db } from '@/lib/merchant/db'
import { merchantAccounts, enterpriseAccounts, enterpriseMerchantApplications } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/merchant/auth'

export async function POST() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [merchant] = await db
    .select({ lenderPartnerId: merchantAccounts.lenderPartnerId })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, session.merchantId))
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (merchant.lenderPartnerId) {
    return NextResponse.json({ error: 'Already under a lender' }, { status: 409 })
  }

  // Find the active capital_lender (pilot: one lender)
  const [lender] = await db
    .select({ id: enterpriseAccounts.id, partnerId: enterpriseAccounts.partnerId })
    .from(enterpriseAccounts)
    .where(
      and(
        eq(enterpriseAccounts.type, 'capital_lender'),
        eq(enterpriseAccounts.isActive, true)
      )
    )
    .limit(1)

  if (!lender) return NextResponse.json({ error: 'No active lender available' }, { status: 404 })

  // Check no pending record already exists
  const [existing] = await db
    .select({ id: enterpriseMerchantApplications.id })
    .from(enterpriseMerchantApplications)
    .where(
      and(
        eq(enterpriseMerchantApplications.enterpriseId, lender.id),
        eq(enterpriseMerchantApplications.merchantId, session.merchantId),
        eq(enterpriseMerchantApplications.status, 'pending')
      )
    )
    .limit(1)

  if (existing) return NextResponse.json({ error: 'An application is already pending' }, { status: 409 })

  const [row] = await db
    .insert(enterpriseMerchantApplications)
    .values({
      enterpriseId: lender.id,
      merchantId: session.merchantId,
      direction: 'application',
    })
    .returning()

  return NextResponse.json({ application: row }, { status: 201 })
}

export async function DELETE() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await db
    .update(enterpriseMerchantApplications)
    .set({ status: 'cancelled', respondedAt: new Date() })
    .where(
      and(
        eq(enterpriseMerchantApplications.merchantId, session.merchantId),
        eq(enterpriseMerchantApplications.direction, 'application'),
        eq(enterpriseMerchantApplications.status, 'pending')
      )
    )

  return NextResponse.json({ ok: true })
}
