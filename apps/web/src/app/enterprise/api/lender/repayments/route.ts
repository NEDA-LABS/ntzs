import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, transfers } from '@ntzs/db'
import { eq, desc, and, sql } from 'drizzle-orm'
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

  const rows = await db
    .select({
      id: transfers.id,
      amountTzs: transfers.amountTzs,
      status: transfers.status,
      txHash: transfers.txHash,
      metadata: transfers.metadata,
      createdAt: transfers.createdAt,
    })
    .from(transfers)
    .where(
      and(
        eq(transfers.partnerId, account.partnerId),
        sql`${transfers.metadata}->>'reason' = 'lender_repayment'`
      )
    )
    .orderBy(desc(transfers.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ repayments: rows })
}
