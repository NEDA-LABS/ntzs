import { NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseDisbursementBatches } from '@ntzs/db'
import { eq, desc } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [account] = await db
    .select({ id: enterpriseAccounts.id, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account || account.type !== 'disbursement_client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const batches = await db
    .select()
    .from(enterpriseDisbursementBatches)
    .where(eq(enterpriseDisbursementBatches.enterpriseId, account.id))
    .orderBy(desc(enterpriseDisbursementBatches.createdAt))
    .limit(100)

  return NextResponse.json({ batches })
}
