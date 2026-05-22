import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseDisbursementBatches, enterpriseDisbursementRows } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [account] = await db
    .select({ id: enterpriseAccounts.id })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [batch] = await db
    .select()
    .from(enterpriseDisbursementBatches)
    .where(and(eq(enterpriseDisbursementBatches.id, id), eq(enterpriseDisbursementBatches.enterpriseId, account.id)))
    .limit(1)

  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await db
    .select()
    .from(enterpriseDisbursementRows)
    .where(eq(enterpriseDisbursementRows.batchId, id))
    .orderBy(enterpriseDisbursementRows.createdAt)

  return NextResponse.json({ batch, rows })
}
