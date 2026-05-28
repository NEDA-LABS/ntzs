import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseDisbursementBatches } from '@ntzs/db'
import { requireServiceKey } from '@/lib/service-auth'

export async function GET(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const enterpriseId = req.headers.get('x-enterprise-id')
  if (!enterpriseId) {
    return NextResponse.json({ error: 'x-enterprise-id header required' }, { status: 400 })
  }

  const [account] = await db
    .select({ id: enterpriseAccounts.id, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, enterpriseId))
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
