import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseDisbursementBatches, enterpriseDisbursementRows } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

const MAX_CONTRACTORS = 20
const MAX_PER_TXN_TZS = 1_000_000

interface CsvRow {
  contractorName: string
  phone: string
  amountTzs: number
  payoutMethod?: 'mobile' | 'eft'
  bankAccount?: string
}

interface RowValidation {
  row: number
  error: string
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [account] = await db
    .select({ id: enterpriseAccounts.id, partnerId: enterpriseAccounts.partnerId, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account || account.type !== 'disbursement_client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!account.partnerId) {
    return NextResponse.json({ error: 'No partner account linked. Contact NEDApay.' }, { status: 403 })
  }

  const { rows, filename } = await req.json() as { rows: CsvRow[]; filename?: string }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
  }

  // Batch-level validation
  if (rows.length > MAX_CONTRACTORS) {
    return NextResponse.json({
      error: `Batch exceeds BoT sandbox limit of ${MAX_CONTRACTORS} contractors (got ${rows.length})`,
    }, { status: 400 })
  }

  // Row-level validation
  const rowErrors: RowValidation[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNum = i + 1
    if (!r.contractorName?.trim()) rowErrors.push({ row: rowNum, error: 'Missing contractor name' })
    if (!r.phone?.trim()) rowErrors.push({ row: rowNum, error: 'Missing phone number' })
    if (!r.amountTzs || isNaN(r.amountTzs) || r.amountTzs <= 0) rowErrors.push({ row: rowNum, error: 'Invalid amount' })
    if (r.amountTzs > MAX_PER_TXN_TZS) rowErrors.push({ row: rowNum, error: `Amount TZS ${r.amountTzs.toLocaleString()} exceeds BoT per-transaction limit of TZS 1,000,000` })
    if (r.payoutMethod === 'eft' && !r.bankAccount?.trim()) rowErrors.push({ row: rowNum, error: 'Bank account required for EFT payout' })
  }

  if (rowErrors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', rowErrors }, { status: 422 })
  }

  const totalAmountTzs = rows.reduce((s, r) => s + r.amountTzs, 0)
  const serviceFeeTzs = Math.ceil(totalAmountTzs * 0.0075)

  const [batch] = await db
    .insert(enterpriseDisbursementBatches)
    .values({
      enterpriseId: account.id,
      partnerId: account.partnerId,
      filename: filename ?? null,
      totalAmountTzs,
      serviceFeeTzs,
      contractorCount: rows.length,
      status: 'pending_review',
    })
    .returning()

  await db.insert(enterpriseDisbursementRows).values(
    rows.map(r => ({
      batchId: batch.id,
      contractorName: r.contractorName.trim(),
      phone: r.phone.trim(),
      amountTzs: r.amountTzs,
      payoutMethod: r.payoutMethod ?? 'mobile',
      bankAccount: r.bankAccount?.trim() ?? null,
    }))
  )

  return NextResponse.json({
    batchId: batch.id,
    contractorCount: rows.length,
    totalAmountTzs,
    serviceFeeTzs,
    totalDue: totalAmountTzs + serviceFeeTzs,
  })
}
