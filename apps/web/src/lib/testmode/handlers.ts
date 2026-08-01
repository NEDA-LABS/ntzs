import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { getBiller, validateUtilityRef, SELCOM_BILLERS } from '@/lib/psp/selcom-billers'
import { isValidTanzanianPhone, normalizePhone, expectedPayoutFeeTzs } from '@/lib/psp'
import { detectNetwork } from '@/lib/psp/routing'
import { checkPerTransactionCap, limitErrorResponse } from '@/lib/sandbox/limits'
import { partners } from '@ntzs/db'
import {
  computeWithdrawalGrossUp,
  createQuoteToken,
  verifyQuoteToken,
  quoteRequired,
  QUOTE_TTL_MS,
  DEFAULT_PLATFORM_FEE_PERCENT,
} from '@/lib/waas/quote'
import {
  computeSpendTotals,
  createSpendQuoteToken,
  verifySpendQuoteToken,
  spendTarget,
  SPEND_MIN_TZS,
  type SpendKind,
} from '@/lib/waas/spend-quote'
import type { AuthenticatedPartner } from '@/lib/waas/auth'

import {
  applyBalance,
  createUser,
  findUserByExternalId,
  findUserById,
  getTransaction,
  queueTestKycWebhook,
  recordTransaction,
  settleDue,
  statusForOutcome,
} from './engine'
import {
  depositOutcome,
  payoutOutcome,
  testKycStatus,
  testMerchantName,
  testReceipt,
  testUtilityToken,
  testRecipientName,
  testTxHash,
} from './scenarios'

/**
 * Test-mode request handlers — contract-identical stand-ins for the live v1
 * money routes.
 *
 * FIDELITY RULES (what a partner learns here must be true in production):
 *  - The FEE MATH IS THE REAL MATH. Every price comes from the same pure
 *    functions live uses (computeWithdrawalGrossUp / computeSpendTotals /
 *    the Selcom tariff tables), so the number shown in test mode is the
 *    number production charges.
 *  - Quotes are REAL signed quotes, verified with the real verifier —
 *    expiry, tampering, quote_mismatch and quote_stale all behave live.
 *  - Validation, error codes, and status vocabularies are copied from the
 *    live routes, not approximated.
 *  - Webhooks are really delivered, signed and retried by the same queue.
 *
 * TWO DELIBERATE DIVERGENCES, both documented in the developer portal:
 *  1. Rail feature flags (SELCOM_SPEND_ENABLED etc.) are IGNORED — test mode
 *     has every rail on, so partners can build against a capability before we
 *     switch it on in production. GET /api/v1/testmode reports what is
 *     actually live.
 *  2. Identity is simulated: no NIDA registry call is ever made.
 */

// ── Shared helpers ─────────────────────────────────────────────────────────

async function partnerFeePercent(partnerId: string): Promise<number> {
  const { db } = getDb()
  const [row] = await db
    .select({ feePercent: partners.feePercent })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)
  const raw = row ? parseFloat(String(row.feePercent ?? '0')) : 0
  return raw > 0 ? raw : DEFAULT_PLATFORM_FEE_PERCENT
}

async function readJson<T>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

const invalidJson = () => NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
const userNotFound = () => NextResponse.json({ error: 'User not found' }, { status: 404 })

/** Endpoints with no simulation (yet). Honest 501 beats a lie. */
export function testNotSupported(feature: string): NextResponse {
  return NextResponse.json(
    {
      error: 'not_available_in_test_mode',
      message: `${feature} is not simulated in test mode. Use a live key, or contact us if you need it in the sandbox.`,
    },
    { status: 501 }
  )
}

// ── Users ──────────────────────────────────────────────────────────────────

export async function testCreateUser(partner: AuthenticatedPartner, request: NextRequest): Promise<NextResponse> {
  await settleDue(partner.id)

  const body = await readJson<{
    externalId: string
    email: string
    name?: string
    phone?: string
    nidaNumber?: string
    country?: string
  }>(request)
  if (!body) return invalidJson()

  const { externalId, email, name, phone, nidaNumber } = body
  if (!externalId || !email) {
    return NextResponse.json({ error: 'externalId and email are required' }, { status: 400 })
  }

  // Idempotent by (partner, externalId) — exactly like live.
  const existing = await findUserByExternalId(partner.id, externalId)
  if (existing) {
    if (existing.kycStatus !== 'approved') {
      return NextResponse.json({
        id: existing.id,
        externalId: existing.externalId,
        email: existing.email,
        name: existing.name,
        phone: existing.phone,
        walletAddress: null,
        balance: 0,
        kycStatus: existing.kycStatus,
      })
    }
    return NextResponse.json({
      id: existing.id,
      externalId: existing.externalId,
      email: existing.email,
      name: existing.name,
      phone: existing.phone,
      walletAddress: existing.walletAddress,
      balance: 0,
    })
  }

  // Same structural prerequisite as live (BoT Parameter 8): no wallet without
  // an identity. The verification itself is simulated.
  if (!nidaNumber) {
    return NextResponse.json(
      {
        error:
          'A NIDA number is required to create a wallet — identity verification is a prerequisite for holding nTZS.',
        code: 'kyc_required',
      },
      { status: 400 }
    )
  }
  const normalizedNida = String(nidaNumber).replace(/\D/g, '')
  if (normalizedNida.length !== 20) {
    return NextResponse.json(
      { error: 'Invalid NIDA number format (20 digits required).', code: 'kyc_failed' },
      { status: 400 }
    )
  }
  if (!phone || !isValidTanzanianPhone(phone)) {
    return NextResponse.json(
      { error: 'A valid Tanzanian phone number is required to create a wallet.', code: 'phone_required' },
      { status: 400 }
    )
  }

  const kycStatus = testKycStatus(normalizedNida)
  const user = await createUser({
    partnerId: partner.id,
    externalId,
    email,
    name: name ?? null,
    phone: normalizePhone(phone),
    kycStatus,
  })

  if (kycStatus === 'pending_review') {
    await queueTestKycWebhook(partner.id, externalId, 'pending_review')
    return NextResponse.json(
      {
        id: user.id,
        externalId,
        email: user.email,
        name: user.name,
        phone: user.phone,
        walletAddress: null,
        balance: 0,
        kycStatus: 'pending_review',
        code: 'kyc_pending_review',
        nextStep: 'kyc_session',
        message:
          'Simulated manual review (NIDA ending 0000). Approve it instantly with POST /api/v1/testmode/users/' +
          user.id +
          '/approve, then re-call this endpoint to get the walletAddress.',
      },
      { status: 202 }
    )
  }

  return NextResponse.json(
    {
      id: user.id,
      externalId,
      email: user.email,
      name: user.name,
      phone: user.phone,
      walletAddress: user.walletAddress,
      balance: 0,
    },
    { status: 201 }
  )
}

export async function testGetUser(partner: AuthenticatedPartner, userId: string): Promise<NextResponse> {
  await settleDue(partner.id)
  const user = await findUserById(partner.id, userId)
  if (!user) return userNotFound()

  return NextResponse.json({
    id: user.id,
    externalId: user.externalId,
    email: user.email,
    phone: user.phone,
    walletAddress: user.kycStatus === 'approved' ? user.walletAddress : null,
    balanceTzs: user.balanceTzs,
    balanceUsdc: 0,
    balanceUsdt: 0,
    kycStatus: user.kycStatus,
  })
}

// ── Deposits (on-ramp) ─────────────────────────────────────────────────────

/** Live vocabulary: 'submitted' → 'minted' | 'rejected'. */
function depositStatusLabel(status: string): string {
  if (status === 'completed') return 'minted'
  if (status === 'failed') return 'rejected'
  return 'submitted'
}

export async function testCreateDeposit(partner: AuthenticatedPartner, request: NextRequest): Promise<NextResponse> {
  await settleDue(partner.id)

  const body = await readJson<{
    userId: string
    amountTzs: number
    paymentMethod?: 'mobile_money' | 'card' | 'lipa_namba'
    phoneNumber?: string
    redirectUrl?: string
  }>(request)
  if (!body) return invalidJson()

  const { userId, phoneNumber } = body
  const paymentMethod = body.paymentMethod ?? 'mobile_money'
  const amountTzs = Math.trunc(Number(body.amountTzs))

  if (!userId || !Number.isFinite(amountTzs) || amountTzs <= 0) {
    return NextResponse.json({ error: 'userId and a positive amountTzs are required' }, { status: 400 })
  }
  const capErr = checkPerTransactionCap(amountTzs)
  if (capErr) return NextResponse.json(limitErrorResponse(capErr), { status: 400 })

  const user = await findUserById(partner.id, userId)
  if (!user) return userNotFound()
  if (user.kycStatus !== 'approved') {
    return NextResponse.json({ error: 'User has no wallet.', code: 'kyc_pending_review' }, { status: 400 })
  }
  if ((paymentMethod === 'mobile_money' || paymentMethod === 'lipa_namba') && !isValidTanzanianPhone(phoneNumber ?? '')) {
    return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })
  }

  const outcome = depositOutcome(amountTzs)
  const tx = await recordTransaction({
    partnerId: partner.id,
    userId: user.id,
    kind: 'deposit',
    outcome,
    amountTzs,
    settlementDeltaTzs: amountTzs, // credited only if it settles 'completed'
    detail: {
      paymentMethod,
      phoneNumber: phoneNumber ? normalizePhone(phoneNumber) : null,
      txHash: testTxHash('mint', partner.id, userId, String(amountTzs)),
    },
  })

  const instructions =
    paymentMethod === 'lipa_namba'
      ? {
          lipaNamba: '70031820',
          accountName: 'NEDA LABS LIMITED (TEST)',
          amountTzs,
          payFromPhone: phoneNumber ? normalizePhone(phoneNumber) : null,
          note: 'Test mode: no payment is required. This deposit settles automatically — poll GET /api/v1/deposits/' + tx.id + '.',
        }
      : paymentMethod === 'card'
        ? undefined
        : 'Test mode: no prompt is sent. This deposit settles automatically — poll GET /api/v1/deposits/' + tx.id + '.'

  return NextResponse.json(
    {
      id: tx.id,
      status: 'submitted',
      amountTzs,
      paymentMethod,
      ...(paymentMethod === 'card'
        ? { paymentUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ntzs.co.tz'}/testmode/checkout/${tx.id}` }
        : { instructions }),
      livemode: false,
    },
    { status: 201 }
  )
}

export async function testGetDeposit(partner: AuthenticatedPartner, depositId: string): Promise<NextResponse> {
  await settleDue(partner.id)
  const tx = await getTransaction(partner.id, depositId)
  if (!tx || tx.kind !== 'deposit') {
    return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
  }
  const detail = (tx.detail ?? {}) as Record<string, unknown>
  const status = depositStatusLabel(tx.status)
  return NextResponse.json({
    id: tx.id,
    status,
    amountTzs: tx.amountTzs,
    paymentMethod: detail.paymentMethod ?? 'mobile_money',
    txHash: status === 'minted' ? (detail.txHash as string) : null,
    createdAt: tx.createdAt,
    livemode: false,
  })
}

// ── Withdrawals (off-ramp to a mobile-money wallet) ────────────────────────

export async function testWithdrawalQuote(partner: AuthenticatedPartner, request: NextRequest): Promise<NextResponse> {
  await settleDue(partner.id)

  const body = await readJson<{ userId: string; amountTzs: number; phoneNumber: string }>(request)
  if (!body) return invalidJson()
  const { userId, phoneNumber } = body
  const receiveAmountTzs = Math.trunc(Number(body.amountTzs))

  if (!userId || !receiveAmountTzs || !phoneNumber) {
    return NextResponse.json({ error: 'userId, amountTzs, and phoneNumber are required' }, { status: 400 })
  }
  if (receiveAmountTzs < 5000) {
    return NextResponse.json({ error: 'Minimum withdrawal amount is 5,000 TZS (recipient net)' }, { status: 400 })
  }
  if (!isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })
  }

  const user = await findUserById(partner.id, userId)
  if (!user) return userNotFound()

  // Sandbox prices EXACTLY like live: the PSP fee follows the serving rail.
  const grossUp = computeWithdrawalGrossUp(receiveAmountTzs, await partnerFeePercent(partner.id), expectedPayoutFeeTzs(receiveAmountTzs))
  const sufficient = user.balanceTzs >= grossUp.burnAmountTzs
  const phone = normalizePhone(phoneNumber)

  const quoteId = sufficient
    ? createQuoteToken({
        partnerId: partner.id,
        userId,
        phone,
        receiveAmountTzs,
        burnAmountTzs: grossUp.burnAmountTzs,
        platformFeeTzs: grossUp.platformFeeTzs,
        nedaFeeTzs: grossUp.nedaFeeTzs,
      })
    : null
  if (sufficient && !quoteId) {
    return NextResponse.json({ error: 'Quotes are not available right now' }, { status: 503 })
  }

  return NextResponse.json({
    quoteId,
    expiresAt: quoteId ? new Date(Date.now() + QUOTE_TTL_MS).toISOString() : null,
    expiresInSeconds: quoteId ? QUOTE_TTL_MS / 1000 : null,
    recipientPhone: phone,
    recipientName: testRecipientName(phone),
    receiveAmountTzs,
    burnAmountTzs: grossUp.burnAmountTzs,
    fees: {
      platformFeeTzs: grossUp.platformFeeTzs,
      pspFeeTzs: grossUp.pspFeeTzs,
      nedaFeeTzs: grossUp.nedaFeeTzs,
      totalFeeTzs: grossUp.platformFeeTzs + grossUp.pspFeeTzs + grossUp.nedaFeeTzs,
    },
    balance: { availableTzs: user.balanceTzs, sufficient },
    livemode: false,
    message: sufficient
      ? 'Show recipientName, fees and receiveAmountTzs to the user, then execute with this quoteId.'
      : `Insufficient balance: available ${user.balanceTzs} TZS, need ${grossUp.burnAmountTzs} TZS to pay out ${receiveAmountTzs} TZS.`,
  })
}

export async function testCreateWithdrawal(partner: AuthenticatedPartner, request: NextRequest): Promise<NextResponse> {
  await settleDue(partner.id)

  const body = await readJson<{ userId: string; amountTzs: number; phoneNumber: string; quoteId?: string }>(request)
  if (!body) return invalidJson()
  const { userId, phoneNumber, quoteId } = body
  const receiveAmountTzs = Math.trunc(Number(body.amountTzs))

  if (!userId || !receiveAmountTzs || !phoneNumber) {
    return NextResponse.json({ error: 'userId, amountTzs, and phoneNumber are required' }, { status: 400 })
  }
  if (receiveAmountTzs < 5000) {
    return NextResponse.json({ error: 'Minimum withdrawal amount is 5,000 TZS (recipient net)' }, { status: 400 })
  }
  if (!isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })
  }

  const user = await findUserById(partner.id, userId)
  if (!user) return userNotFound()

  const { burnAmountTzs, platformFeeTzs, nedaFeeTzs, pspFeeTzs } = computeWithdrawalGrossUp(
    receiveAmountTzs,
    await partnerFeePercent(partner.id),
    expectedPayoutFeeTzs(receiveAmountTzs)
  )
  const phone = normalizePhone(phoneNumber)

  // Quote enforcement — the real verifier, the real codes.
  if (quoteId) {
    const v = verifyQuoteToken(quoteId)
    if (!v.ok) {
      return NextResponse.json(
        {
          error: 'invalid_quote',
          reason: v.reason,
          message: 'Quote is invalid or expired — request a new one via POST /api/v1/withdrawals/quote.',
        },
        { status: 400 }
      )
    }
    const q = v.payload
    if (q.partnerId !== partner.id || q.userId !== userId || q.phone !== phone || q.receiveAmountTzs !== receiveAmountTzs) {
      return NextResponse.json(
        { error: 'quote_mismatch', message: 'Quote was issued for different terms (user/phone/amount). Request a new quote.' },
        { status: 400 }
      )
    }
    if (q.burnAmountTzs !== burnAmountTzs) {
      return NextResponse.json(
        { error: 'quote_stale', message: 'Pricing changed since this quote was issued. Request a new quote.' },
        { status: 409 }
      )
    }
  } else if (quoteRequired()) {
    return NextResponse.json(
      {
        error: 'quote_required',
        message:
          'This withdrawal requires a quote: call POST /api/v1/withdrawals/quote, show the user the recipient name, fees and net amount, then retry with the returned quoteId.',
      },
      { status: 400 }
    )
  }

  const capErr = checkPerTransactionCap(burnAmountTzs)
  if (capErr) return NextResponse.json(limitErrorResponse(capErr), { status: 400 })

  // Debit first — the simulated burn. Fails closed on an overdraw.
  if (!(await applyBalance(user.id, -burnAmountTzs))) {
    return NextResponse.json(
      {
        error: 'Insufficient balance',
        message: `Need ${burnAmountTzs} TZS (incl. fees) to pay out ${receiveAmountTzs} TZS; available ${user.balanceTzs} TZS.`,
      },
      { status: 400 }
    )
  }

  const outcome = payoutOutcome(phone)
  const decisive = outcome === 'fail' || outcome === 'reconcile'
  const tx = await recordTransaction({
    partnerId: partner.id,
    userId: user.id,
    kind: 'withdrawal',
    outcome,
    amountTzs: receiveAmountTzs,
    // Only a failure refunds; reconcile_required deliberately does not.
    settlementDeltaTzs: outcome === 'fail' ? burnAmountTzs : 0,
    fees: { platformFeeTzs, pspFeeTzs, nedaFeeTzs },
    detail: { phone, burnAmountTzs, recipientName: testRecipientName(phone) },
    // Decisive failures surface synchronously, exactly like live.
    instant: decisive,
  })

  if (outcome === 'fail') {
    return NextResponse.json(
      {
        id: tx.id,
        status: 'burned',
        payoutStatus: 'reverted',
        error: 'Payout failed; burn reverted — balance restored. (Test scenario: destination ends in 13.)',
        livemode: false,
      },
      { status: 502 }
    )
  }
  if (outcome === 'reconcile') {
    return NextResponse.json(
      {
        id: tx.id,
        status: 'burned',
        payoutStatus: 'reconcile_required',
        error: 'Payout could not be confirmed',
        message:
          'Withdrawal is under review. On-chain burn completed but the PSP did not confirm the payout. Do not retry — an operator will confirm and either complete the payout or restore the balance. (Test scenario: destination ends in 02.)',
        livemode: false,
      },
      { status: 502 }
    )
  }

  return NextResponse.json(
    {
      id: tx.id,
      status: 'burned',
      amountTzs: burnAmountTzs,
      receiveAmountTzs,
      recipientName: testRecipientName(phone),
      platformFeeTzs,
      pspFeeTzs,
      nedaFeeTzs,
      totalFeeTzs: platformFeeTzs + pspFeeTzs + nedaFeeTzs,
      livemode: false,
      message: `Withdrawal processed: ${receiveAmountTzs} TZS on its way to the recipient (${platformFeeTzs + pspFeeTzs + nedaFeeTzs} TZS in fees).`,
    },
    { status: 201 }
  )
}

export async function testGetWithdrawal(partner: AuthenticatedPartner, id: string): Promise<NextResponse> {
  await settleDue(partner.id)
  const tx = await getTransaction(partner.id, id)
  if (!tx || tx.kind !== 'withdrawal') {
    return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 })
  }
  const detail = (tx.detail ?? {}) as Record<string, unknown>
  const payoutStatus =
    tx.status === 'completed' ? 'completed' : tx.status === 'failed' ? 'reverted' : tx.status === 'reconcile_required' ? 'reconcile_required' : 'pending'
  return NextResponse.json({
    id: tx.id,
    status: 'burned',
    payoutStatus,
    amountTzs: detail.burnAmountTzs ?? tx.amountTzs,
    receiveAmountTzs: tx.amountTzs,
    recipientName: detail.recipientName ?? null,
    fees: tx.fees,
    createdAt: tx.createdAt,
    livemode: false,
  })
}

// ── Spend (off-ramp to a Lipa till / biller) ───────────────────────────────

interface SpendDestination {
  kind: SpendKind
  payNumber?: string
  network?: string
  utilityCode?: string
  utilityRef?: string
}

/** Shared destination validation — identical rules and codes to the live route. */
function parseSpendDestination(body: {
  kind: SpendKind
  payNumber?: string
  network?: string
  utilityCode?: string
  utilityRef?: string
}): { ok: true; dest: SpendDestination } | { ok: false; response: NextResponse } {
  if (body.kind === 'lipa') {
    const payNumber = String(body.payNumber ?? '').replace(/\s+/g, '')
    if (!/^\d{4,12}$/.test(payNumber)) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'payNumber must be the merchant Lipa Namba (4–12 digits)' }, { status: 400 }),
      }
    }
    return { ok: true, dest: { kind: 'lipa', payNumber, network: body.network?.trim() || undefined } }
  }

  const utilityCode = String(body.utilityCode ?? '').trim().toUpperCase()
  const utilityRef = String(body.utilityRef ?? '').trim()
  if (!getBiller(utilityCode)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'unknown_biller',
          message: `utilityCode '${utilityCode}' is not in the biller catalogue.`,
          supportedCodes: SELCOM_BILLERS.map((b) => b.code),
        },
        { status: 400 }
      ),
    }
  }
  const refCheck = validateUtilityRef(utilityCode, utilityRef)
  if (!refCheck.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_utility_ref', message: refCheck.reason }, { status: 400 }),
    }
  }
  return { ok: true, dest: { kind: 'bill', utilityCode, utilityRef } }
}

const destinationDigits = (d: SpendDestination) => (d.kind === 'lipa' ? d.payNumber ?? '' : d.utilityRef ?? '')

export async function testSpendQuote(partner: AuthenticatedPartner, request: NextRequest): Promise<NextResponse> {
  await settleDue(partner.id)

  const body = await readJson<{
    userId: string
    kind: SpendKind
    amountTzs: number
    payNumber?: string
    network?: string
    utilityCode?: string
    utilityRef?: string
  }>(request)
  if (!body) return invalidJson()

  const { userId, kind } = body
  if (!userId || !kind || !body.amountTzs) {
    return NextResponse.json({ error: 'userId, kind, and amountTzs are required' }, { status: 400 })
  }
  if (kind !== 'lipa' && kind !== 'bill') {
    return NextResponse.json({ error: "kind must be 'lipa' or 'bill'" }, { status: 400 })
  }

  const principalTzs = Math.trunc(Number(body.amountTzs))
  if (!Number.isFinite(principalTzs) || principalTzs < SPEND_MIN_TZS) {
    return NextResponse.json({ error: `Minimum spend amount is ${SPEND_MIN_TZS} TZS (principal)` }, { status: 400 })
  }

  const parsed = parseSpendDestination(body)
  if (!parsed.ok) return parsed.response
  const dest = parsed.dest

  const capErr = checkPerTransactionCap(principalTzs)
  if (capErr) return NextResponse.json(limitErrorResponse(capErr), { status: 400 })

  const user = await findUserById(partner.id, userId)
  if (!user) return userNotFound()

  const totals = computeSpendTotals(kind, principalTzs, await partnerFeePercent(partner.id), dest.utilityCode)
  const sufficient = user.balanceTzs >= totals.burnAmountTzs
  const recipientName = testRecipientName(destinationDigits(dest))
  const target = spendTarget(kind, dest)

  const quoteId = sufficient
    ? createSpendQuoteToken({
        kind,
        partnerId: partner.id,
        userId,
        target,
        network: dest.network,
        principalTzs,
        selcomFeeTzs: totals.selcomFeeTzs,
        platformFeeTzs: totals.platformFeeTzs,
        nedaFeeTzs: totals.nedaFeeTzs,
        burnAmountTzs: totals.burnAmountTzs,
        recipientName,
      })
    : null
  if (sufficient && !quoteId) {
    return NextResponse.json({ error: 'Quotes are not available right now' }, { status: 503 })
  }

  return NextResponse.json({
    quoteId,
    expiresAt: quoteId ? new Date(Date.now() + QUOTE_TTL_MS).toISOString() : null,
    expiresInSeconds: quoteId ? QUOTE_TTL_MS / 1000 : null,
    kind,
    target:
      kind === 'lipa'
        ? { payNumber: dest.payNumber, network: dest.network ?? null }
        : { utilityCode: dest.utilityCode, utilityRef: dest.utilityRef },
    recipientName,
    ...(recipientName ? {} : { nameUnavailableReason: 'No registered name for this destination (test scenario: ends in 00).' }),
    principalTzs,
    burnAmountTzs: totals.burnAmountTzs,
    fees: {
      selcomFeeTzs: totals.selcomFeeTzs,
      platformFeeTzs: totals.platformFeeTzs,
      nedaFeeTzs: totals.nedaFeeTzs,
      totalFeeTzs: totals.selcomFeeTzs + totals.platformFeeTzs + totals.nedaFeeTzs,
    },
    balance: { availableTzs: user.balanceTzs, sufficient },
    livemode: false,
    message: sufficient
      ? 'Show recipientName, fees and principalTzs to the user, then execute with this quoteId (required).'
      : `Insufficient balance: available ${user.balanceTzs} TZS, need ${totals.burnAmountTzs} TZS to pay ${principalTzs} TZS (incl. fees).`,
  })
}

export async function testCreateSpend(partner: AuthenticatedPartner, request: NextRequest): Promise<NextResponse> {
  await settleDue(partner.id)

  const body = await readJson<{
    userId: string
    quoteId?: string
    kind: SpendKind
    amountTzs: number
    payNumber?: string
    network?: string
    utilityCode?: string
    utilityRef?: string
    externalId?: string
  }>(request)
  if (!body) return invalidJson()

  const { userId, kind, quoteId } = body
  if (!userId || !kind || !body.amountTzs) {
    return NextResponse.json({ error: 'userId, kind, and amountTzs are required' }, { status: 400 })
  }
  if (kind !== 'lipa' && kind !== 'bill') {
    return NextResponse.json({ error: "kind must be 'lipa' or 'bill'" }, { status: 400 })
  }

  const principalTzs = Math.trunc(Number(body.amountTzs))
  const parsed = parseSpendDestination(body)
  if (!parsed.ok) return parsed.response
  const dest = parsed.dest
  const target = spendTarget(kind, dest)

  if (!quoteId) {
    return NextResponse.json(
      {
        error: 'quote_required',
        message:
          'Spend requires a quote: call POST /api/v1/spend/quote, show the user the recipient name and fees, then retry with the returned quoteId.',
      },
      { status: 400 }
    )
  }
  const v = verifySpendQuoteToken(quoteId)
  if (!v.ok) {
    return NextResponse.json(
      {
        error: 'invalid_quote',
        reason: v.reason,
        message: 'Quote is invalid or expired — request a new one via POST /api/v1/spend/quote.',
      },
      { status: 400 }
    )
  }
  const q = v.payload
  if (q.partnerId !== partner.id || q.userId !== userId || q.kind !== kind || q.target !== target || q.principalTzs !== principalTzs) {
    return NextResponse.json(
      { error: 'quote_mismatch', message: 'Quote was issued for different terms (user/destination/amount). Request a new quote.' },
      { status: 400 }
    )
  }

  const user = await findUserById(partner.id, userId)
  if (!user) return userNotFound()

  const totals = computeSpendTotals(kind, principalTzs, await partnerFeePercent(partner.id), dest.utilityCode)
  if (
    q.burnAmountTzs !== totals.burnAmountTzs ||
    q.selcomFeeTzs !== totals.selcomFeeTzs ||
    q.platformFeeTzs !== totals.platformFeeTzs ||
    q.nedaFeeTzs !== totals.nedaFeeTzs
  ) {
    return NextResponse.json(
      { error: 'quote_stale', message: 'Pricing changed since this quote was issued. Request a new quote.' },
      { status: 409 }
    )
  }

  if (!(await applyBalance(user.id, -totals.burnAmountTzs))) {
    return NextResponse.json(
      {
        error: 'Insufficient balance',
        message: `Need ${totals.burnAmountTzs} TZS (incl. fees) to pay ${principalTzs} TZS; available ${user.balanceTzs} TZS.`,
      },
      { status: 400 }
    )
  }

  const outcome = payoutOutcome(destinationDigits(dest))
  const decisive = outcome === 'fail' || outcome === 'reconcile'
  const reference = testTxHash('spend', partner.id, target, String(principalTzs)).slice(2, 14)
  const tx = await recordTransaction({
    partnerId: partner.id,
    userId: user.id,
    kind: 'spend',
    outcome,
    amountTzs: principalTzs,
    settlementDeltaTzs: outcome === 'fail' ? totals.burnAmountTzs : 0,
    fees: { selcomFeeTzs: totals.selcomFeeTzs, platformFeeTzs: totals.platformFeeTzs, nedaFeeTzs: totals.nedaFeeTzs },
    detail: {
      kind,
      target,
      reference,
      externalId: body.externalId ?? null,
      recipientName: q.recipientName,
      burnAmountTzs: totals.burnAmountTzs,
      actualChargesTzs: totals.selcomFeeTzs,
      selcomReceipt: testReceipt(reference),
      // A bill settlement carries its voucher — the product of the purchase.
      // Deterministic, so a partner can assert on it in their own tests.
      ...(kind === 'bill'
        ? {
            utilityToken: testUtilityToken(reference),
            utilityUnits: `${(principalTzs / 357).toFixed(1)}kWh`,
            utilityReceipt: `9${reference.replace(/\D/g, '').padEnd(17, '0').slice(0, 17)}`,
          }
        : {}),
    },
    instant: decisive,
  })

  if (outcome === 'fail') {
    return NextResponse.json(
      {
        id: tx.id,
        status: 'failed',
        payoutStatus: 'reverted',
        error: 'Payment failed; burn reverted — balance restored. (Test scenario: destination ends in 13.)',
        livemode: false,
      },
      { status: 502 }
    )
  }
  if (outcome === 'reconcile') {
    return NextResponse.json(
      {
        id: tx.id,
        status: 'failed',
        payoutStatus: 'reconcile_required',
        error: 'Payment could not be confirmed',
        message:
          'Spend is under review. The burn completed but the payment was not confirmed. Do not retry — an operator will confirm and either complete the payment or restore the balance. (Test scenario: destination ends in 02.)',
        livemode: false,
      },
      { status: 502 }
    )
  }

  return NextResponse.json(
    {
      id: tx.id,
      status: 'burned',
      payoutStatus: statusForOutcome(outcome) === 'pending' ? 'pending' : 'completed',
      reference,
      kind,
      target:
        kind === 'lipa'
          ? { payNumber: dest.payNumber, network: dest.network ?? null }
          : { utilityCode: dest.utilityCode, utilityRef: dest.utilityRef },
      recipientName: q.recipientName,
      principalTzs,
      burnAmountTzs: totals.burnAmountTzs,
      fees: {
        selcomFeeTzs: totals.selcomFeeTzs,
        platformFeeTzs: totals.platformFeeTzs,
        nedaFeeTzs: totals.nedaFeeTzs,
        totalFeeTzs: totals.selcomFeeTzs + totals.platformFeeTzs + totals.nedaFeeTzs,
      },
      livemode: false,
      message: `Payment of ${principalTzs} TZS dispatched${q.recipientName ? ` to ${q.recipientName}` : ''} (${totals.selcomFeeTzs + totals.platformFeeTzs + totals.nedaFeeTzs} TZS in fees).`,
    },
    { status: 201 }
  )
}

// ── Transfers (wallet → wallet, on-chain in live) ──────────────────────────

export async function testCreateTransfer(partner: AuthenticatedPartner, request: NextRequest): Promise<NextResponse> {
  await settleDue(partner.id)

  const body = await readJson<{
    fromUserId: string
    toUserId?: string
    toAddress?: string
    amount?: number
    amountTzs?: number
    token?: string
  }>(request)
  if (!body) return invalidJson()

  const token = (body.token ?? 'ntzs').toLowerCase()
  if (token !== 'ntzs') {
    return testNotSupported(`Transfers of ${token.toUpperCase()}`)
  }

  const amount = Math.trunc(Number(body.amount ?? body.amountTzs))
  const { fromUserId, toUserId, toAddress } = body
  if (!fromUserId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'fromUserId and a positive amount are required' }, { status: 400 })
  }
  if (!toUserId && !toAddress) {
    return NextResponse.json({ error: 'Either toUserId or toAddress is required' }, { status: 400 })
  }

  const sender = await findUserById(partner.id, fromUserId)
  if (!sender) return userNotFound()

  const recipient = toUserId ? await findUserById(partner.id, toUserId) : null
  if (toUserId && !recipient) {
    return NextResponse.json({ error: 'Recipient user not found' }, { status: 404 })
  }

  if (!(await applyBalance(sender.id, -amount))) {
    return NextResponse.json(
      { error: 'Insufficient balance', message: `Need ${amount} TZS; available ${sender.balanceTzs} TZS.` },
      { status: 400 }
    )
  }
  if (recipient) await applyBalance(recipient.id, amount)

  const destination = recipient?.walletAddress ?? String(toAddress)
  const txHash = testTxHash('transfer', partner.id, fromUserId, destination, String(amount))
  const tx = await recordTransaction({
    partnerId: partner.id,
    userId: sender.id,
    kind: 'transfer',
    outcome: 'complete',
    amountTzs: amount,
    detail: { toUserId: toUserId ?? null, toAddress: destination, txHash },
    instant: true,
  })

  return NextResponse.json(
    {
      id: tx.id,
      status: 'completed',
      txHash,
      token: 'ntzs',
      amount,
      recipientAmount: amount,
      feeAmount: 0,
      toAddress: destination,
      amountTzs: amount,
      recipientAmountTzs: amount,
      feeAmountTzs: 0,
      livemode: false,
    },
    { status: 201 }
  )
}

// ── Name lookup ────────────────────────────────────────────────────────────

export async function testLookupName(request: NextRequest): Promise<NextResponse> {
  const body = await readJson<{ phoneNumber?: unknown }>(request)
  if (!body) return invalidJson()

  const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : ''
  if (!phoneNumber || !isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json(
      { error: 'phoneNumber must be a valid Tanzanian mobile number', code: 'invalid_phone' },
      { status: 400 }
    )
  }
  const phone = normalizePhone(phoneNumber)
  return NextResponse.json({ phone, network: detectNetwork(phone), name: testRecipientName(phone), livemode: false })
}

/**
 * POST /api/v1/lookup/merchant-name in test mode — deterministic trading names,
 * no PSP call. A till ending `00` resolves to null so the "we could not verify
 * this merchant" branch is reachable without hunting for an unregistered till.
 */
export async function testLookupMerchant(request: NextRequest): Promise<NextResponse> {
  const body = await readJson<{ kind?: unknown; payNumber?: unknown; utilityCode?: unknown; utilityRef?: unknown }>(request)
  if (!body) return invalidJson()

  const kind = body.kind === 'bill' ? 'bill' : body.kind === 'lipa' ? 'lipa' : null
  if (!kind) return NextResponse.json({ error: "kind must be 'lipa' or 'bill'" }, { status: 400 })

  if (kind === 'lipa') {
    const payNumber = String(body.payNumber ?? '').replace(/\s+/g, '')
    if (!/^\d{4,12}$/.test(payNumber)) {
      return NextResponse.json({ error: 'payNumber must be the merchant Lipa Namba (4–12 digits)' }, { status: 400 })
    }
    return NextResponse.json({
      kind, target: `lipa:${payNumber}`, payNumber,
      name: testMerchantName(payNumber),
      livemode: false,
    })
  }

  const utilityCode = String(body.utilityCode ?? '').trim().toUpperCase()
  const utilityRef = String(body.utilityRef ?? '').trim()
  const biller = getBiller(utilityCode)
  if (!biller) {
    return NextResponse.json(
      { error: 'unknown_biller', message: `utilityCode '${utilityCode}' is not in the biller catalogue.`, supportedCodes: SELCOM_BILLERS.map((b) => b.code) },
      { status: 400 }
    )
  }
  const refCheck = validateUtilityRef(utilityCode, utilityRef)
  if (!refCheck.ok) {
    return NextResponse.json({ error: 'invalid_utility_ref', message: refCheck.reason }, { status: 400 })
  }

  return NextResponse.json({
    kind, target: `bill:${utilityCode}:${utilityRef}`, utilityCode, utilityRef,
    name: testMerchantName(utilityRef),
    livemode: false,
  })
}

/**
 * GET /api/v1/spend/:id in test mode — status + settlement including the
 * utility voucher. The retrieval path a client uses after an ambiguous POST,
 * instead of retrying the POST and paying twice.
 */
export async function testGetSpend(partner: AuthenticatedPartner, id: string): Promise<NextResponse> {
  await settleDue(partner.id)
  const tx = await getTransaction(partner.id, id)
  if (!tx || tx.kind !== 'spend') {
    return NextResponse.json({ error: 'Spend not found' }, { status: 404 })
  }
  const detail = (tx.detail ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof detail[k] === 'string' ? (detail[k] as string) : null)
  const num = (k: string) => (typeof detail[k] === 'number' ? (detail[k] as number) : null)
  const payoutStatus =
    tx.status === 'completed' ? 'completed'
    : tx.status === 'failed' ? 'reverted'
    : tx.status === 'reconcile_required' ? 'reconcile_required'
    : 'pending'
  const settled = payoutStatus === 'completed'
  const target = String(detail.target ?? '')
  const [tkind, a, b] = target.split(':')
  return NextResponse.json({
    id: tx.id,
    status: payoutStatus === 'reverted' ? 'failed' : 'burned',
    payoutStatus,
    payoutError: payoutStatus === 'reverted' ? 'Payment failed; burn reverted — balance restored.' : null,
    reference: str('reference'),
    kind: tkind || null,
    target: tkind === 'lipa' ? { payNumber: a ?? null, network: null } : { utilityCode: a ?? null, utilityRef: b ?? null },
    recipientName: str('recipientName'),
    principalTzs: tx.amountTzs,
    burnAmountTzs: num('burnAmountTzs') ?? tx.amountTzs,
    utilityToken: settled ? str('utilityToken') : null,
    utilityUnits: settled ? str('utilityUnits') : null,
    utilityReceipt: settled ? str('utilityReceipt') : null,
    selcomReceipt: settled ? str('selcomReceipt') : null,
    actualChargesTzs: settled ? num('actualChargesTzs') : null,
    createdAt: tx.createdAt,
    livemode: false,
  })
}
