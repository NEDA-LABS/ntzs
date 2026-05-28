import { NextRequest, NextResponse } from 'next/server'
import { and, count, eq, gte, sum } from 'drizzle-orm'
import { db } from '@/lib/merchant/db'
import { merchantAccounts, merchantCollections, merchantPaymentLinks } from '@ntzs/db'
import { requireServiceKey } from '@/lib/service-auth'

export async function GET(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) {
    return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })
  }

  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [account] = await db
    .select({ settlementPendingTzs: merchantAccounts.settlementPendingTzs })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  const [totals] = await db
    .select({
      totalCollected: sum(merchantCollections.amountTzs),
      totalSettled: sum(merchantCollections.settlementAmountTzs),
    })
    .from(merchantCollections)
    .where(
      and(
        eq(merchantCollections.merchantId, merchantId),
        eq(merchantCollections.collectionStatus, 'minted'),
      ),
    )

  const [today] = await db
    .select({ amountTzs: sum(merchantCollections.amountTzs) })
    .from(merchantCollections)
    .where(
      and(
        eq(merchantCollections.merchantId, merchantId),
        eq(merchantCollections.collectionStatus, 'minted'),
        gte(merchantCollections.createdAt, startOfDay),
      ),
    )

  const [thisMonth] = await db
    .select({ amountTzs: sum(merchantCollections.amountTzs) })
    .from(merchantCollections)
    .where(
      and(
        eq(merchantCollections.merchantId, merchantId),
        eq(merchantCollections.collectionStatus, 'minted'),
        gte(merchantCollections.createdAt, startOfMonth),
      ),
    )

  const [pending] = await db
    .select({ amountTzs: sum(merchantCollections.amountTzs) })
    .from(merchantCollections)
    .where(
      and(
        eq(merchantCollections.merchantId, merchantId),
        eq(merchantCollections.collectionStatus, 'pending'),
      ),
    )

  const [activeLinks] = await db
    .select({ count: count() })
    .from(merchantPaymentLinks)
    .where(
      and(
        eq(merchantPaymentLinks.merchantId, merchantId),
        eq(merchantPaymentLinks.isActive, true),
      ),
    )

  return NextResponse.json({
    totalCollected: Number(totals?.totalCollected ?? 0),
    totalSettled: Number(totals?.totalSettled ?? 0),
    settlementPendingTzs: account?.settlementPendingTzs ?? 0,
    today: Number(today?.amountTzs ?? 0),
    thisMonth: Number(thisMonth?.amountTzs ?? 0),
    pending: Number(pending?.amountTzs ?? 0),
    activeLinks: activeLinks?.count ?? 0,
  })
}
