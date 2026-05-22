import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseDisbursementBatches, enterpriseDisbursementRows } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAnyRole(['super_admin', 'platform_compliance']) } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const [batch] = await db
    .select()
    .from(enterpriseDisbursementBatches)
    .where(eq(enterpriseDisbursementBatches.id, id))
    .limit(1)

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (batch.status !== 'awaiting_funds') {
    return NextResponse.json({ error: `Cannot approve batch in status: ${batch.status}` }, { status: 409 })
  }

  const rows = await db
    .select()
    .from(enterpriseDisbursementRows)
    .where(eq(enterpriseDisbursementRows.batchId, id))

  if (!rows.length) {
    return NextResponse.json({ error: 'Batch has no rows' }, { status: 400 })
  }

  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  if (!contractAddress) {
    return NextResponse.json({ error: 'Contract address not configured' }, { status: 500 })
  }

  const { sql: rawSql } = getDb()

  // Resolve sentinel user for burn requests
  const platformUserId = await resolvePlatformUser(rawSql)
  if (!platformUserId) {
    return NextResponse.json({ error: 'Platform user not configured' }, { status: 500 })
  }

  const platformWalletRows = await rawSql<{ id: string }[]>`
    select id from wallets where user_id = ${platformUserId} and chain = 'base' limit 1
  `
  const platformWalletId = platformWalletRows[0]?.id
  if (!platformWalletId) {
    return NextResponse.json({ error: 'Platform wallet not configured' }, { status: 500 })
  }

  // Mark batch as approved → processing
  await db
    .update(enterpriseDisbursementBatches)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(eq(enterpriseDisbursementBatches.id, id))

  // Create a burn_request per row
  for (const row of rows) {
    const burnRows = await rawSql<{ id: string }[]>`
      insert into burn_requests (
        user_id, wallet_id, chain, contract_address,
        amount_tzs, reason, status,
        requested_by_user_id, recipient_phone,
        metadata, created_at, updated_at
      ) values (
        ${platformUserId}, ${platformWalletId}, 'base', ${contractAddress},
        ${row.amountTzs}, 'enterprise_disbursement', 'approved',
        ${platformUserId}, ${row.phone},
        ${JSON.stringify({ disbursementRowId: row.id, batchId: id, contractorName: row.contractorName })}::jsonb,
        now(), now()
      )
      returning id
    `
    const burnId = burnRows[0]?.id
    if (burnId) {
      await db
        .update(enterpriseDisbursementRows)
        .set({ status: 'processing', burnRequestId: burnId, updatedAt: new Date() })
        .where(and(eq(enterpriseDisbursementRows.id, row.id), eq(enterpriseDisbursementRows.batchId, id)))
    }
  }

  return NextResponse.json({ ok: true, rowsQueued: rows.length })
}

async function resolvePlatformUser(sql: ReturnType<typeof getDb>['sql']): Promise<string | null> {
  const platformEmail = process.env.PLATFORM_ADMIN_EMAIL || 'ops@nedapay.co.tz'
  const rows = await sql<{ id: string }[]>`
    select id from users where email = ${platformEmail} limit 1
  `
  return rows[0]?.id ?? null
}
