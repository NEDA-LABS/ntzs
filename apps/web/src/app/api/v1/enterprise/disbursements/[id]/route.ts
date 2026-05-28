import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseDisbursementBatches, enterpriseDisbursementRows } from '@ntzs/db'
import { requireServiceKey } from '@/lib/service-auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const enterpriseId = req.headers.get('x-enterprise-id')
  if (!enterpriseId) {
    return NextResponse.json({ error: 'x-enterprise-id header required' }, { status: 400 })
  }

  const { id } = await params

  const [account] = await db
    .select({ id: enterpriseAccounts.id })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, enterpriseId))
    .limit(1)

  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [batch] = await db
    .select()
    .from(enterpriseDisbursementBatches)
    .where(
      and(
        eq(enterpriseDisbursementBatches.id, id),
        eq(enterpriseDisbursementBatches.enterpriseId, account.id),
      ),
    )
    .limit(1)

  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await db
    .select()
    .from(enterpriseDisbursementRows)
    .where(eq(enterpriseDisbursementRows.batchId, id))
    .orderBy(enterpriseDisbursementRows.createdAt)

  return NextResponse.json({ batch, rows })
}
