import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { isTestMode, testWithdrawalQuote } from '@/lib/testmode'
import { authenticatePartner } from '@/lib/waas/auth'
import { fundingSourceKey, resolveFundingSource } from '@/lib/waas/funding-source'
import { isValidTanzanianPhone, normalizePhone, lookupRecipientName } from '@/lib/psp'
import { enforceSandboxLimits, limitErrorResponse } from '@/lib/sandbox/limits'
import { partners } from '@ntzs/db'
import { computeWithdrawalGrossUp, createQuoteToken, DEFAULT_PLATFORM_FEE_PERCENT, QUOTE_TTL_MS } from '@/lib/waas/quote'

const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

/**
 * POST /api/v1/withdrawals/quote — price + verify a withdrawal BEFORE executing.
 *
 * Returns everything the payer-facing UI must show on the confirmation screen:
 * the recipient's registered name, the full fee breakdown, the net the
 * recipient receives, and a signed `quoteId` (valid 5 minutes) that
 * POST /api/v1/withdrawals accepts — and, once WAAS_REQUIRE_QUOTE=true,
 * REQUIRES. Making the quote a prerequisite is what guarantees every client
 * has name + fees in hand before money moves.
 *
 * Body: { userId, amountTzs, phoneNumber } — amountTzs is the amount the
 * recipient should RECEIVE (same semantics as the execute endpoint).
 *
 * Response: {
 *   quoteId, expiresAt, expiresInSeconds,
 *   recipientPhone, recipientName,          // name null when lookup has no answer
 *   receiveAmountTzs, burnAmountTzs,
 *   fees: { platformFeeTzs, pspFeeTzs, totalFeeTzs },
 *   balance: { availableTzs, sufficient }   // sufficient=false → quoteId omitted
 * }
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult

  if (isTestMode(partner)) return testWithdrawalQuote(partner, request)

  let body: { userId?: string; subWalletId?: string; amountTzs: number; phoneNumber: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { amountTzs: receiveAmountRaw, phoneNumber } = body
  if (!receiveAmountRaw || !phoneNumber) {
    return NextResponse.json({ error: 'amountTzs and phoneNumber are required' }, { status: 400 })
  }

  const receiveAmountTzs = Math.trunc(Number(receiveAmountRaw))
  if (!Number.isFinite(receiveAmountTzs) || receiveAmountTzs < 5000) {
    return NextResponse.json({ error: 'Minimum withdrawal amount is 5,000 TZS (recipient net)' }, { status: 400 })
  }
  if (!isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })
  }

  const { db } = getDb()

  // The user's wallet, or — for agent-float partners — a partner sub-wallet.
  const funding = await resolveFundingSource(partner, body)
  if ('error' in funding) return funding.error
  const { source } = funding

  // Same fee resolution as the execute route — a quote must price exactly
  // what execution will charge.
  const [partnerRow] = await db
    .select({ feePercent: partners.feePercent })
    .from(partners)
    .where(eq(partners.id, partner.id))
    .limit(1)
  const partnerFeePercentRaw = partnerRow ? parseFloat(String(partnerRow.feePercent ?? '0')) : 0
  const feePercent = partnerFeePercentRaw > 0 ? partnerFeePercentRaw : DEFAULT_PLATFORM_FEE_PERCENT

  const grossUp = computeWithdrawalGrossUp(receiveAmountTzs, feePercent)

  // Caps behave exactly like execution so a quotable withdrawal is an
  // executable withdrawal.
  // One call enforces BoT Parameters #3/#4/#5 AND records the block —
  // evidence cannot be forgotten at a call site.
  const limitErr = await enforceSandboxLimits(source.subject, grossUp.burnAmountTzs, {
    endpoint: 'v1/withdrawals/quote', stage: 'quote', partnerId: partner.id,
  })
  if (limitErr) return NextResponse.json(limitErrorResponse(limitErr), { status: 400 })

  if (!BASE_RPC_URL || !NTZS_CONTRACT_ADDRESS_BASE) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  let availableTzs: number
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, NTZS_BALANCE_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(source.address)
    availableTzs = Number(balanceWei / BigInt(10) ** BigInt(18))
  } catch (err) {
    console.error('[v1/withdrawals/quote] Balance check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to verify balance' }, { status: 500 })
  }

  const sufficient = availableTzs >= grossUp.burnAmountTzs

  // Registered wallet name — the "you are paying JOHN DOE" line. Non-fatal:
  // null simply means the UI shows the number without a name.
  const phone = normalizePhone(phoneNumber)
  let recipientName: string | null = null
  try {
    const info = await lookupRecipientName(phone)
    recipientName = info.name ?? null
  } catch {
    recipientName = null
  }

  // No token for an insufficient balance — a quote that cannot execute must
  // not look executable.
  const quoteId = sufficient
    ? createQuoteToken({
        partnerId: partner.id,
        userId: source.kind === 'user' ? source.userId : '',
        src: fundingSourceKey(source),
        phone,
        receiveAmountTzs,
        burnAmountTzs: grossUp.burnAmountTzs,
        platformFeeTzs: grossUp.platformFeeTzs,
        nedaFeeTzs: grossUp.nedaFeeTzs,
      })
    : null

  if (sufficient && !quoteId) {
    // Signing secret missing — fail loudly rather than degrade the contract.
    console.error('[v1/withdrawals/quote] WAAS_QUOTE_SECRET / FX_JWT_SECRET not configured')
    return NextResponse.json({ error: 'Quotes are not available right now' }, { status: 503 })
  }

  return NextResponse.json({
    quoteId,
    expiresAt: quoteId ? new Date(Date.now() + QUOTE_TTL_MS).toISOString() : null,
    expiresInSeconds: quoteId ? QUOTE_TTL_MS / 1000 : null,
    recipientPhone: phone,
    recipientName,
    receiveAmountTzs,
    burnAmountTzs: grossUp.burnAmountTzs,
    fees: {
      platformFeeTzs: grossUp.platformFeeTzs,
      pspFeeTzs: grossUp.pspFeeTzs,
      nedaFeeTzs: grossUp.nedaFeeTzs,
      totalFeeTzs: grossUp.platformFeeTzs + grossUp.pspFeeTzs + grossUp.nedaFeeTzs,
    },
    balance: { availableTzs, sufficient },
    message: sufficient
      ? 'Show recipientName, fees and receiveAmountTzs to the user, then execute with this quoteId.'
      : `Insufficient balance: available ${availableTzs} TZS, need ${grossUp.burnAmountTzs} TZS to pay out ${receiveAmountTzs} TZS.`,
  })
}
