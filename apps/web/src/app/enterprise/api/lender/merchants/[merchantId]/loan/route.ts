import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts, enterpriseLoanAgreements } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

/**
 * POST — create a loan facility for a linked merchant that has none yet.
 * Body: { principalTzs, interestRatePct?, termDays? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params

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

  const [merchant] = await db
    .select({ lenderPartnerId: merchantAccounts.lenderPartnerId })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant || merchant.lenderPartnerId !== account.partnerId) {
    return NextResponse.json({ error: 'Merchant not linked to this lender' }, { status: 404 })
  }

  const [existing] = await db
    .select({ id: enterpriseLoanAgreements.id })
    .from(enterpriseLoanAgreements)
    .where(and(
      eq(enterpriseLoanAgreements.merchantId, merchantId),
      eq(enterpriseLoanAgreements.partnerId, account.partnerId),
      eq(enterpriseLoanAgreements.status, 'active'),
    ))
    .limit(1)
  if (existing) {
    return NextResponse.json({ error: 'An active facility already exists. Edit it instead.' }, { status: 409 })
  }

  const body = await req.json().catch(() => ({}))
  const principalTzs = Math.trunc(Number(body.principalTzs))
  const interestRatePct = Number(body.interestRatePct ?? 0)

  if (!principalTzs || principalTzs <= 0) {
    return NextResponse.json({ error: 'principalTzs must be positive' }, { status: 400 })
  }
  if (!Number.isInteger(interestRatePct) || interestRatePct < 0 || interestRatePct > 200) {
    return NextResponse.json({ error: 'interestRatePct must be 0–200' }, { status: 400 })
  }

  let termDays: number | null = null
  let dueAt: Date | null = null
  if (body.termDays !== undefined && body.termDays !== null && body.termDays !== '') {
    termDays = Number(body.termDays)
    if (!Number.isInteger(termDays) || termDays < 1 || termDays > 3650) {
      return NextResponse.json({ error: 'termDays must be 1–3650' }, { status: 400 })
    }
    dueAt = new Date(Date.now() + termDays * 24 * 60 * 60 * 1000)
  }

  const interestTzs = Math.floor(principalTzs * interestRatePct / 100)
  const totalOwedTzs = principalTzs + interestTzs

  const [loan] = await db
    .insert(enterpriseLoanAgreements)
    .values({ partnerId: account.partnerId, merchantId, principalTzs, interestRatePct, interestTzs, totalOwedTzs, termDays, dueAt })
    .returning({ id: enterpriseLoanAgreements.id })

  return NextResponse.json({
    ok: true, loanId: loan?.id, principalTzs, interestRatePct, interestTzs, totalOwedTzs, termDays,
    dueAt: dueAt?.toISOString() ?? null,
  }, { status: 201 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params

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

  const [merchant] = await db
    .select({ lenderPartnerId: merchantAccounts.lenderPartnerId })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant || merchant.lenderPartnerId !== account.partnerId) {
    return NextResponse.json({ error: 'Merchant not linked to this lender' }, { status: 404 })
  }

  const [loan] = await db
    .select({ id: enterpriseLoanAgreements.id, repaidTzs: enterpriseLoanAgreements.repaidTzs, principalTzs: enterpriseLoanAgreements.principalTzs, createdAt: enterpriseLoanAgreements.createdAt })
    .from(enterpriseLoanAgreements)
    .where(
      and(
        eq(enterpriseLoanAgreements.merchantId, merchantId),
        eq(enterpriseLoanAgreements.partnerId, account.partnerId),
        eq(enterpriseLoanAgreements.status, 'active')
      )
    )
    .limit(1)

  if (!loan) return NextResponse.json({ error: 'No active loan agreement found' }, { status: 404 })

  const body = await req.json()
  const updates: Partial<typeof enterpriseLoanAgreements.$inferInsert> = { updatedAt: new Date() }
  const result: Record<string, number | string | null> = {}

  // Interest rate — only adjustable before repayments have started.
  if (body.interestRatePct !== undefined) {
    const interestRatePct = Number(body.interestRatePct)
    if (!Number.isInteger(interestRatePct) || interestRatePct < 0 || interestRatePct > 200) {
      return NextResponse.json({ error: 'interestRatePct must be 0–200' }, { status: 400 })
    }
    if (loan.repaidTzs > 0) {
      return NextResponse.json({ error: 'Cannot change interest rate after repayments have started' }, { status: 409 })
    }
    const interestTzs = Math.floor(loan.principalTzs * interestRatePct / 100)
    const totalOwedTzs = loan.principalTzs + interestTzs
    updates.interestRatePct = interestRatePct
    updates.interestTzs = interestTzs
    updates.totalOwedTzs = totalOwedTzs
    result.interestRatePct = interestRatePct
    result.interestTzs = interestTzs
    result.totalOwedTzs = totalOwedTzs
  }

  // Loan term — sets the repayment deadline (due_at = loan start + term).
  if (body.termDays !== undefined) {
    const termDays = Number(body.termDays)
    if (!Number.isInteger(termDays) || termDays < 1 || termDays > 3650) {
      return NextResponse.json({ error: 'termDays must be 1–3650' }, { status: 400 })
    }
    const dueAt = new Date(loan.createdAt.getTime() + termDays * 24 * 60 * 60 * 1000)
    updates.termDays = termDays
    updates.dueAt = dueAt
    result.termDays = termDays
    result.dueAt = dueAt.toISOString()
  }

  if (Object.keys(result).length === 0) {
    return NextResponse.json({ error: 'Provide interestRatePct and/or termDays' }, { status: 400 })
  }

  await db
    .update(enterpriseLoanAgreements)
    .set(updates)
    .where(eq(enterpriseLoanAgreements.id, loan.id))

  return NextResponse.json({ ok: true, ...result })
}
