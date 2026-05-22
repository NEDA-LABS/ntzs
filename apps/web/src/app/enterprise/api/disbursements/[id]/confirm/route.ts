import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseDisbursementBatches } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    .select({ id: enterpriseDisbursementBatches.id, status: enterpriseDisbursementBatches.status })
    .from(enterpriseDisbursementBatches)
    .where(and(eq(enterpriseDisbursementBatches.id, id), eq(enterpriseDisbursementBatches.enterpriseId, account.id)))
    .limit(1)

  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (batch.status !== 'pending_review') {
    return NextResponse.json({ error: `Cannot confirm batch in status: ${batch.status}` }, { status: 409 })
  }

  await db
    .update(enterpriseDisbursementBatches)
    .set({ status: 'awaiting_funds', updatedAt: new Date() })
    .where(eq(enterpriseDisbursementBatches.id, id))

  return NextResponse.json({ ok: true })
}
