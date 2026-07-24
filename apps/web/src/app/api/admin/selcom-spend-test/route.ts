import { NextRequest, NextResponse } from 'next/server'

import { requireAnyRole } from '@/lib/auth/rbac'
import { writeAuditLog } from '@/lib/audit'
import { payBill, payLipa, checkPayoutStatus } from '@/lib/psp/selcom'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Hard cap for this endpoint — it exists to validate the rails with pocket
 * change the day Selcom flips them live, never to move real value. */
const MAX_TEST_AMOUNT_TZS = 5000

/**
 * POST /api/admin/selcom-spend-test — super-admin probe for the neda-bill-pay
 * and neda-lipa-payout endpoints (Dhimant's collection, Selcom-side deployment
 * in progress). Dispatches ONE tiny transaction and immediately reads back the
 * authoritative status via /v1/transaction/query, so a single call shows both
 * how the dispatch was answered and what the transaction settled to.
 *
 * Body: { kind: 'bill', utilityCode, utilityRef, amountTzs, transId? }
 *     | { kind: 'lipa', payNumber, network?, amountTzs, transId? }
 *
 * Gated per rail: kind 'bill' requires SELCOM_BILLPAY_ENABLED='true',
 * kind 'lipa' requires SELCOM_LIPA_ENABLED='true' — keep both unset until
 * Selcom confirms deployment and the fee tariffs. This endpoint MOVES MONEY
 * (from the custodial account) when the rails are live; amount is capped at
 * 5,000 TZS and every call is audit-logged.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAnyRole(['super_admin'])

  let body: {
    kind?: string
    amountTzs?: number
    utilityCode?: string
    utilityRef?: string
    payNumber?: string
    network?: string
    transId?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }

  const kind = body.kind
  if (kind !== 'bill' && kind !== 'lipa') {
    return NextResponse.json({ error: "kind must be 'bill' or 'lipa'" }, { status: 400 })
  }

  const amountTzs = Number(body.amountTzs)
  if (!Number.isInteger(amountTzs) || amountTzs <= 0) {
    return NextResponse.json({ error: 'amountTzs must be a positive integer' }, { status: 400 })
  }
  if (amountTzs > MAX_TEST_AMOUNT_TZS) {
    return NextResponse.json(
      { error: `test endpoint caps amountTzs at ${MAX_TEST_AMOUNT_TZS}` },
      { status: 400 }
    )
  }

  if (kind === 'bill' && process.env.SELCOM_BILLPAY_ENABLED !== 'true') {
    return NextResponse.json({ error: 'SELCOM_BILLPAY_ENABLED is not set' }, { status: 403 })
  }
  if (kind === 'lipa' && process.env.SELCOM_LIPA_ENABLED !== 'true') {
    return NextResponse.json({ error: 'SELCOM_LIPA_ENABLED is not set' }, { status: 403 })
  }

  let dispatch
  if (kind === 'bill') {
    if (!body.utilityCode || !body.utilityRef) {
      return NextResponse.json({ error: 'bill requires utilityCode and utilityRef' }, { status: 400 })
    }
    dispatch = await payBill({
      utilityCode: body.utilityCode,
      utilityRef: body.utilityRef,
      amountTzs,
      transId: body.transId,
    })
  } else {
    if (!body.payNumber) {
      return NextResponse.json({ error: 'lipa requires payNumber' }, { status: 400 })
    }
    dispatch = await payLipa({
      payNumber: body.payNumber,
      network: body.network,
      amountTzs,
      transId: body.transId,
    })
  }

  // Read back the authoritative status regardless of the dispatch verdict —
  // for AMBIGUOUS/duplicate cases the query is the truth, not the dispatch.
  const query = dispatch.reference ? await checkPayoutStatus(dispatch.reference) : null

  await writeAuditLog(
    'selcom.spend_test',
    'selcom_transaction',
    dispatch.reference ?? 'unknown',
    {
      kind,
      amountTzs,
      utilityCode: body.utilityCode ?? null,
      utilityRef: body.utilityRef ?? null,
      payNumber: body.payNumber ?? null,
      network: body.network ?? null,
      dispatchSuccess: dispatch.success,
      dispatchError: dispatch.error ?? null,
      dispatchErrorCode: dispatch.errorCode ?? null,
      queryStatus: query?.status ?? null,
    },
    admin.id
  )

  return NextResponse.json({ kind, amountTzs, dispatch, query })
}
