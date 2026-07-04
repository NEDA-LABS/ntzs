import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts, transfers } from '@ntzs/db'
import { eq, desc, and, sql, inArray } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

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

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200)
  const offset = Number(url.searchParams.get('offset') ?? '0')

  // Both repayment kinds: the per-sale split drip ('lender_repayment') and the
  // full balance-driven payoff ('lender_payoff') — excluding the payoff hid the
  // largest transfer of a loan's life from the lender's ledger.
  const rows = await db
    .select({
      id: transfers.id,
      amountTzs: transfers.amountTzs,
      status: transfers.status,
      txHash: transfers.txHash,
      metadata: transfers.metadata,
      createdAt: transfers.createdAt,
      reason: sql<string>`${transfers.metadata}->>'reason'`,
      merchantId: sql<string | null>`${transfers.metadata}->>'merchantId'`,
    })
    .from(transfers)
    .where(
      and(
        eq(transfers.partnerId, account.partnerId),
        sql`${transfers.metadata}->>'reason' in ('lender_repayment', 'lender_payoff')`
      )
    )
    .orderBy(desc(transfers.createdAt))
    .limit(limit)
    .offset(offset)

  // Name the merchant on each row so the ledger reads as a ledger, not UUIDs.
  const merchantIds = [...new Set(rows.map((r) => r.merchantId).filter((id): id is string => !!id))]
  const names = merchantIds.length
    ? await db
        .select({ id: merchantAccounts.id, handle: merchantAccounts.handle, businessName: merchantAccounts.businessName })
        .from(merchantAccounts)
        .where(inArray(merchantAccounts.id, merchantIds))
    : []
  const nameById = new Map(names.map((m) => [m.id, m]))

  return NextResponse.json({
    repayments: rows.map((r) => ({
      ...r,
      kind: r.reason === 'lender_payoff' ? 'full_payoff' : 'split_repayment',
      merchantHandle: r.merchantId ? nameById.get(r.merchantId)?.handle ?? null : null,
      merchantBusinessName: r.merchantId ? nameById.get(r.merchantId)?.businessName ?? null : null,
    })),
  })
}
