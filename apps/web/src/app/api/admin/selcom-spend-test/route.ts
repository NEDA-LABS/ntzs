import { NextRequest, NextResponse } from 'next/server'

import { requireAnyRole } from '@/lib/auth/rbac'
import { writeAuditLog } from '@/lib/audit'
import { payBill, payLipa, checkPayoutStatus, queryTransactionRaw, processDisbursement, detectWalletFiCode, normalizePhone, nedaAccountLookup, BANK_FI_CODES } from '@/lib/psp/selcom'

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
/**
 * GET ?reference=<transId> — re-check a previous dispatch's authoritative
 * status. Returns both the mapped status and Selcom's raw query payload
 * (settlement details / charges / names live there when they exist).
 * Read-only; no flags required.
 */
export async function GET(request: NextRequest) {
  await requireAnyRole(['super_admin'])
  const reference = request.nextUrl.searchParams.get('reference')?.trim()
  if (!reference) {
    return NextResponse.json({ error: 'reference query param required' }, { status: 400 })
  }
  const [query, raw] = await Promise.all([checkPayoutStatus(reference), queryTransactionRaw(reference)])
  return NextResponse.json({ reference, query, raw })
}

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
    phone?: string
    fiCode?: string
    bankCode?: string
    accountNumber?: string
    recipientName?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }

  const kind = body.kind
  if (kind !== 'bill' && kind !== 'lipa' && kind !== 'wallet' && kind !== 'bank') {
    return NextResponse.json({ error: "kind must be 'bill', 'lipa', 'wallet' or 'bank'" }, { status: 400 })
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
  if ((kind === 'wallet' || kind === 'bank') && process.env.SELCOM_DISBURSEMENTS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'SELCOM_DISBURSEMENTS_ENABLED is not set' }, { status: 403 })
  }

  let dispatch
  let bankLookup: { name: string | null; reason?: string } | null = null
  if (kind === 'bank') {
    // Bank cash-out probe — banking phase 1. Same doctrine that ended the
    // 1 Aug outage: every FI code in BANK_FI_CODES is an unproven claim until
    // one live dispatch through this endpoint settles. Name lookup runs first
    // as evidence (and because a transfer should carry the registered name).
    const bankCode = body.bankCode?.trim().toUpperCase() ?? ''
    const bank = BANK_FI_CODES[bankCode]
    if (!bank) {
      return NextResponse.json(
        { error: `bankCode must be one of the canonical FI codes (see docs/psp/selcom-destination-shortcodes.md)`, supportedCodes: Object.keys(BANK_FI_CODES) },
        { status: 400 },
      )
    }
    const accountNumber = body.accountNumber?.trim() ?? ''
    const accountOk = bank.reference === 'alphanumeric'
      ? /^[A-Za-z0-9]{5,24}$/.test(accountNumber)
      : /^\d{5,20}$/.test(accountNumber)
    if (!accountOk) {
      return NextResponse.json(
        { error: `accountNumber must be ${bank.reference === 'alphanumeric' ? '5–24 alphanumeric characters' : '5–20 digits'} for ${bank.name}` },
        { status: 400 },
      )
    }

    if (bank.lookup) {
      const info = await nedaAccountLookup(bankCode, accountNumber).catch(() => ({ name: null as string | null, reason: 'lookup threw' }))
      bankLookup = { name: info.name ?? null, ...('reason' in info && info.reason ? { reason: String(info.reason) } : {}) }
    } else {
      bankLookup = { name: null, reason: `${bank.name} has name lookup disabled` }
    }

    dispatch = await processDisbursement({
      recipientFiCode: bankCode,
      recipientAccount: accountNumber,
      recipientName: bankLookup.name || body.recipientName?.trim() || 'NEDA LABS PROBE',
      amountTzs,
      narration: 'bank payout probe',
      transId: body.transId,
    })
  } else if (kind === 'wallet') {
    // Wallet cash-in probe — the EXACT call the withdrawal rail makes, with
    // Selcom's raw verdict returned instead of being flattened into a user
    // message. `fiCode` overrides the shortcode-table default so the two
    // candidate vocabularies (VMCASHIN-style table codes vs the MPESA-style
    // codes in Selcom's own wallet-transfer example — never live-confirmed)
    // can be A/B tested from a browser without a deploy.
    if (!body.phone) {
      return NextResponse.json({ error: 'wallet requires phone' }, { status: 400 })
    }
    let phone: string
    try {
      phone = normalizePhone(body.phone)
    } catch (e) {
      return NextResponse.json({ error: `invalid phone: ${e instanceof Error ? e.message : e}` }, { status: 400 })
    }
    let fiCode: string
    try {
      fiCode = body.fiCode?.trim().toUpperCase() || detectWalletFiCode(phone)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
    }
    dispatch = await processDisbursement({
      recipientFiCode: fiCode,
      recipientAccount: phone,
      recipientName: 'NEDA Labs Test',
      amountTzs,
      narration: 'wallet payout probe',
      transId: body.transId,
    })
  } else if (kind === 'bill') {
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
      phone: body.phone ?? null,
      fiCode: body.fiCode ?? null,
      bankCode: body.bankCode ?? null,
      accountNumber: body.accountNumber ?? null,
      bankLookupName: bankLookup?.name ?? null,
      dispatchSuccess: dispatch.success,
      dispatchError: dispatch.error ?? null,
      dispatchErrorCode: dispatch.errorCode ?? null,
      queryStatus: query?.status ?? null,
    },
    admin.id
  )

  return NextResponse.json({ kind, amountTzs, dispatch, query, ...(bankLookup ? { lookup: bankLookup } : {}) })
}
