import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseDisbursementBatches, enterpriseDisbursementRows } from '@ntzs/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

/**
 * Recipient analytics for a disbursement client. Recipients aren't a first-class
 * table — they're disbursement rows keyed by phone — so we aggregate across all
 * of this enterprise's batches.
 *
 * GET /enterprise/api/disbursements/recipients          → aggregated list
 * GET /enterprise/api/disbursements/recipients?phone=…   → one recipient's payouts
 */
export async function GET(req: NextRequest) {
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

  const phone = req.nextUrl.searchParams.get('phone')

  // ── Single recipient: payout history across batches ──────────────────────
  if (phone) {
    const rows = await db
      .select({
        id: enterpriseDisbursementRows.id,
        contractorName: enterpriseDisbursementRows.contractorName,
        amountTzs: enterpriseDisbursementRows.amountTzs,
        payoutMethod: enterpriseDisbursementRows.payoutMethod,
        status: enterpriseDisbursementRows.status,
        payoutReference: enterpriseDisbursementRows.payoutReference,
        payoutError: enterpriseDisbursementRows.payoutError,
        createdAt: enterpriseDisbursementRows.createdAt,
        batchId: enterpriseDisbursementBatches.id,
        batchFilename: enterpriseDisbursementBatches.filename,
        batchStatus: enterpriseDisbursementBatches.status,
      })
      .from(enterpriseDisbursementRows)
      .innerJoin(enterpriseDisbursementBatches, eq(enterpriseDisbursementBatches.id, enterpriseDisbursementRows.batchId))
      .where(and(
        eq(enterpriseDisbursementBatches.enterpriseId, account.id),
        eq(enterpriseDisbursementRows.phone, phone),
      ))
      .orderBy(desc(enterpriseDisbursementRows.createdAt))
      .limit(500)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No payouts found for this recipient' }, { status: 404 })
    }

    const totalTzs = rows.reduce((s, r) => s + r.amountTzs, 0)
    const completedTzs = rows.filter(r => r.status === 'completed').reduce((s, r) => s + r.amountTzs, 0)
    return NextResponse.json({
      recipient: {
        phone,
        name: rows[0].contractorName,
        payoutCount: rows.length,
        successCount: rows.filter(r => r.status === 'completed').length,
        failedCount: rows.filter(r => r.status === 'failed').length,
        totalTzs,
        completedTzs,
      },
      payouts: rows,
    })
  }

  // ── Aggregated recipient list ────────────────────────────────────────────
  const recipients = await db
    .select({
      phone: enterpriseDisbursementRows.phone,
      name: sql<string>`(array_agg(${enterpriseDisbursementRows.contractorName} order by ${enterpriseDisbursementRows.createdAt} desc))[1]`,
      totalTzs: sql<number>`coalesce(sum(${enterpriseDisbursementRows.amountTzs}), 0)`.mapWith(Number),
      completedTzs: sql<number>`coalesce(sum(${enterpriseDisbursementRows.amountTzs}) filter (where ${enterpriseDisbursementRows.status} = 'completed'), 0)`.mapWith(Number),
      payoutCount: sql<number>`count(*)`.mapWith(Number),
      successCount: sql<number>`count(*) filter (where ${enterpriseDisbursementRows.status} = 'completed')`.mapWith(Number),
      failedCount: sql<number>`count(*) filter (where ${enterpriseDisbursementRows.status} = 'failed')`.mapWith(Number),
      lastPaidAt: sql<string>`max(${enterpriseDisbursementRows.createdAt})`,
    })
    .from(enterpriseDisbursementRows)
    .innerJoin(enterpriseDisbursementBatches, eq(enterpriseDisbursementBatches.id, enterpriseDisbursementRows.batchId))
    .where(eq(enterpriseDisbursementBatches.enterpriseId, account.id))
    .groupBy(enterpriseDisbursementRows.phone)
    .orderBy(desc(sql`sum(${enterpriseDisbursementRows.amountTzs})`))
    .limit(500)

  return NextResponse.json({ recipients })
}
