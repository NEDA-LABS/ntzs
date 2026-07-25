import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { authenticatePartner } from '@/lib/waas/auth'
import { nedaAccountLookup } from '@/lib/psp/selcom'
import { getBiller, validateUtilityRef, SELCOM_BILLERS } from '@/lib/psp/selcom-billers'
import { checkPerTransactionCap, checkUserPeriodLimits, limitErrorResponse } from '@/lib/sandbox/limits'
import { wallets, partnerUsers, partners } from '@ntzs/db'
import { QUOTE_TTL_MS } from '@/lib/waas/quote'
import {
  computeSpendTotals,
  createSpendQuoteToken,
  spendEnabled,
  spendKindEnabled,
  spendTarget,
  DEFAULT_PLATFORM_FEE_PERCENT,
  SPEND_MIN_TZS,
  type SpendKind,
} from '@/lib/waas/spend-quote'

const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

/**
 * POST /api/v1/spend/quote — price + verify a spend BEFORE executing.
 *
 * Spend = burn nTZS → the reserve pays a merchant Lipa Namba (any network)
 * or a biller (LUKU, GEPG, DSTV, airtime, …). This endpoint returns
 * everything the payer-facing UI must show on the confirmation screen — the
 * merchant/biller's registered name, the full fee breakdown, and the total
 * that will be burned — plus a signed quoteId (valid 5 minutes) that
 * POST /api/v1/spend REQUIRES. Spend is quote-first by design: there is no
 * un-quoted execution path.
 *
 * Body: { userId, kind: 'lipa'|'bill', amountTzs, payNumber?, network?,
 *         utilityCode?, utilityRef? }
 *   - amountTzs is the PRINCIPAL the till/biller receives.
 *   - lipa → payNumber (+ optional network hint, normally blank)
 *   - bill → utilityCode (catalogue in GET /api/v1/spend/billers … or docs)
 *            + utilityRef (meter/control/smartcard number)
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult

  if (!spendEnabled()) {
    return NextResponse.json(
      { error: 'spend_disabled', message: 'Spend rails are not enabled on this environment yet.' },
      { status: 503 }
    )
  }

  let body: {
    userId: string
    kind: SpendKind
    amountTzs: number
    payNumber?: string
    network?: string
    utilityCode?: string
    utilityRef?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { userId, kind } = body
  if (!userId || !kind || !body.amountTzs) {
    return NextResponse.json({ error: 'userId, kind, and amountTzs are required' }, { status: 400 })
  }
  if (kind !== 'lipa' && kind !== 'bill') {
    return NextResponse.json({ error: "kind must be 'lipa' or 'bill'" }, { status: 400 })
  }
  if (!spendKindEnabled(kind)) {
    return NextResponse.json(
      { error: 'spend_kind_disabled', message: `The ${kind} rail is not enabled on this environment yet.` },
      { status: 503 }
    )
  }

  const principalTzs = Math.trunc(Number(body.amountTzs))
  if (!Number.isFinite(principalTzs) || principalTzs < SPEND_MIN_TZS) {
    return NextResponse.json({ error: `Minimum spend amount is ${SPEND_MIN_TZS} TZS (principal)` }, { status: 400 })
  }

  // ── Destination validation ────────────────────────────────────────────────
  let payNumber: string | undefined
  let network: string | undefined
  let utilityCode: string | undefined
  let utilityRef: string | undefined

  if (kind === 'lipa') {
    payNumber = String(body.payNumber ?? '').replace(/\s+/g, '')
    if (!/^\d{4,12}$/.test(payNumber)) {
      return NextResponse.json({ error: 'payNumber must be the merchant Lipa Namba (4–12 digits)' }, { status: 400 })
    }
    network = body.network?.trim() || undefined
  } else {
    utilityCode = String(body.utilityCode ?? '').trim().toUpperCase()
    utilityRef = String(body.utilityRef ?? '').trim()
    const biller = getBiller(utilityCode)
    if (!biller) {
      return NextResponse.json(
        {
          error: 'unknown_biller',
          message: `utilityCode '${utilityCode}' is not in the biller catalogue.`,
          supportedCodes: SELCOM_BILLERS.map((b) => b.code),
        },
        { status: 400 }
      )
    }
    const refCheck = validateUtilityRef(utilityCode, utilityRef)
    if (!refCheck.ok) {
      return NextResponse.json({ error: 'invalid_utility_ref', message: refCheck.reason }, { status: 400 })
    }
  }

  const { db } = getDb()

  const [mapping] = await db
    .select({ externalId: partnerUsers.externalId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, userId)))
    .limit(1)
  if (!mapping) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Same fee resolution as execution — a quote must price exactly what
  // execution will charge.
  const [partnerRow] = await db
    .select({ feePercent: partners.feePercent })
    .from(partners)
    .where(eq(partners.id, partner.id))
    .limit(1)
  const partnerFeePercentRaw = partnerRow ? parseFloat(String(partnerRow.feePercent ?? '0')) : 0
  const feePercent = partnerFeePercentRaw > 0 ? partnerFeePercentRaw : DEFAULT_PLATFORM_FEE_PERCENT

  const totals = computeSpendTotals(kind, principalTzs, feePercent, utilityCode)

  // Caps behave exactly like execution (applied to the burn total).
  const perTxnErr = checkPerTransactionCap(totals.burnAmountTzs)
  if (perTxnErr) return NextResponse.json(limitErrorResponse(perTxnErr), { status: 400 })
  const periodErr = await checkUserPeriodLimits(userId, totals.burnAmountTzs)
  if (periodErr) return NextResponse.json(limitErrorResponse(periodErr), { status: 400 })

  const [wallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)
  if (!wallet || wallet.address.startsWith('0x_pending_')) {
    return NextResponse.json({ error: 'User wallet is not provisioned yet' }, { status: 400 })
  }

  if (!BASE_RPC_URL || !NTZS_CONTRACT_ADDRESS_BASE) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  let availableTzs: number
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, NTZS_BALANCE_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(wallet.address)
    availableTzs = Number(balanceWei / BigInt(10) ** BigInt(18))
  } catch (err) {
    console.error('[v1/spend/quote] Balance check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to verify balance' }, { status: 500 })
  }

  const sufficient = availableTzs >= totals.burnAmountTzs

  // Registered name of the destination — merchant tills via SB2LIPA, bill
  // accounts via their utilityCode (established with Selcom, 25 Jul).
  // Non-fatal: null means the UI shows the raw number with a warning.
  const lookupBank = kind === 'lipa' ? 'SB2LIPA' : (utilityCode as string)
  const lookupAccount = kind === 'lipa' ? (payNumber as string) : (utilityRef as string)
  let recipientName: string | null = null
  let nameUnavailableReason: string | undefined
  try {
    const info = await nedaAccountLookup(lookupBank, lookupAccount)
    recipientName = info.name
    if (!info.name) nameUnavailableReason = info.reason
  } catch {
    recipientName = null
  }

  const target = spendTarget(kind, { payNumber, utilityCode, utilityRef })

  // No token for an insufficient balance — a quote that cannot execute must
  // not look executable.
  const quoteId = sufficient
    ? createSpendQuoteToken({
        kind,
        partnerId: partner.id,
        userId,
        target,
        network,
        principalTzs,
        selcomFeeTzs: totals.selcomFeeTzs,
        platformFeeTzs: totals.platformFeeTzs,
        burnAmountTzs: totals.burnAmountTzs,
        recipientName,
      })
    : null

  if (sufficient && !quoteId) {
    console.error('[v1/spend/quote] WAAS_QUOTE_SECRET / FX_JWT_SECRET not configured')
    return NextResponse.json({ error: 'Quotes are not available right now' }, { status: 503 })
  }

  return NextResponse.json({
    quoteId,
    expiresAt: quoteId ? new Date(Date.now() + QUOTE_TTL_MS).toISOString() : null,
    expiresInSeconds: quoteId ? QUOTE_TTL_MS / 1000 : null,
    kind,
    target: kind === 'lipa' ? { payNumber, network: network ?? null } : { utilityCode, utilityRef },
    recipientName,
    ...(recipientName ? {} : { nameUnavailableReason }),
    principalTzs,
    burnAmountTzs: totals.burnAmountTzs,
    fees: {
      selcomFeeTzs: totals.selcomFeeTzs,
      platformFeeTzs: totals.platformFeeTzs,
      totalFeeTzs: totals.selcomFeeTzs + totals.platformFeeTzs,
    },
    balance: { availableTzs, sufficient },
    message: sufficient
      ? 'Show recipientName, fees and principalTzs to the user, then execute with this quoteId (required).'
      : `Insufficient balance: available ${availableTzs} TZS, need ${totals.burnAmountTzs} TZS to pay ${principalTzs} TZS (incl. fees).`,
  })
}
