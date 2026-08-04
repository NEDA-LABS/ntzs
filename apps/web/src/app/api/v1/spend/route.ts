import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, BURNER_PRIVATE_KEY, PLATFORM_TREASURY_ADDRESS } from '@/lib/env'
import { isTestMode, testCreateSpend } from '@/lib/testmode'
import { authenticatePartner } from '@/lib/waas/auth'
import { fundingSourceKey, resolveFundingSource } from '@/lib/waas/funding-source'
import { enforceSandboxLimits, limitErrorResponse } from '@/lib/sandbox/limits'
import { burnRequests, partners } from '@ntzs/db'
import {
  computeSpendTotals,
  verifySpendQuoteToken,
  spendEnabled,
  spendKindEnabled,
  spendTarget,
  DEFAULT_PLATFORM_FEE_PERCENT,
  type SpendKind,
} from '@/lib/waas/spend-quote'
import { dispatchSpendPayment } from '@/lib/waas/spend-dispatch'
import { DUPLICATE_WINDOW_MS, duplicateSpendResponse, findDuplicateSpend } from '@/lib/waas/spend-duplicate'
import { SAFE_BURN_THRESHOLD_TZS } from '@/lib/approvals/thresholds'

export const maxDuration = 60

/**
 * How much of `maxDuration` the handler may spend before it must be writing a
 * response. The awaited settle poll is bounded by what is left of this after
 * the on-chain burn, so the request cannot be killed mid-flight AFTER Selcom
 * has been paid — the failure mode that made a customer pay twice on
 * 30 July 2026.
 */
const RESPONSE_BUDGET_MS = 45_000


const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const
const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

/**
 * POST /api/v1/spend — burn nTZS → the reserve pays a Lipa till / biller.
 *
 * Quote-first BY DESIGN: a valid quoteId from POST /api/v1/spend/quote is
 * REQUIRED — it proves the client had the merchant/biller name and the full
 * fee breakdown in hand, for exactly these terms, within the last 5 minutes.
 *
 * Money-safety follows the withdrawal machinery verbatim:
 *  - burn on-chain first, from the user's wallet (balance re-checked)
 *  - dispatch the Selcom payment with a transId generated ONCE and stored
 *    BEFORE dispatch — Selcom treats it as the idempotency key, so no path
 *    can double-pay
 *  - authoritative failure (status query) → claim-once revert re-mints the
 *    user; ambiguous transport outcomes → reconcile_required for an operator
 *    (never auto-reverted, the withdrawal lesson)
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult

  // TEST MODE: simulated burn + Selcom dispatch. Deliberately ABOVE the rail
  // flag — partners build against spend in the sandbox before it is switched
  // on in production.
  if (isTestMode(partner)) return testCreateSpend(partner, request)

  if (!spendEnabled()) {
    return NextResponse.json(
      { error: 'spend_disabled', message: 'Spend rails are not enabled on this environment yet.' },
      { status: 503 }
    )
  }

  let body: {
    userId?: string
    /** Agent float (SmartWakala) — funds the spend from a partner sub-wallet. */
    subWalletId?: string
    quoteId?: string
    kind: SpendKind
    amountTzs: number
    payNumber?: string
    network?: string
    utilityCode?: string
    utilityRef?: string
    /** Deliberately repeat an identical payment inside the duplicate window. */
    allowDuplicate?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { quoteId, kind } = body
  if (!kind || !body.amountTzs) {
    return NextResponse.json({ error: 'kind and amountTzs are required' }, { status: 400 })
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
  const payNumber = body.payNumber ? String(body.payNumber).replace(/\s+/g, '') : undefined
  const network = body.network?.trim() || undefined
  const utilityCode = body.utilityCode ? String(body.utilityCode).trim().toUpperCase() : undefined
  const utilityRef = body.utilityRef ? String(body.utilityRef).trim() : undefined
  const target = spendTarget(kind, { payNumber, utilityCode, utilityRef })

  // Funds come from the user's wallet, or — for agent-float partners — a
  // partner sub-wallet. Resolved before the quote check so the quote can be
  // verified against the source it was priced for.
  const funding = await resolveFundingSource(partner, body)
  if ('error' in funding) return funding.error
  const { source } = funding

  // ── Quote verification — MANDATORY (the disclosure contract) ──────────────
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
      { error: 'invalid_quote', reason: v.reason, message: 'Quote is invalid or expired — request a new one via POST /api/v1/spend/quote.' },
      { status: 400 }
    )
  }
  const q = v.payload
  const quoteSrc = q.src ?? `user:${q.userId}`
  if (
    q.partnerId !== partner.id ||
    quoteSrc !== fundingSourceKey(source) ||
    q.kind !== kind ||
    q.target !== target ||
    q.principalTzs !== principalTzs
  ) {
    return NextResponse.json(
      { error: 'quote_mismatch', message: 'Quote was issued for different terms (user/destination/amount). Request a new quote.' },
      { status: 400 }
    )
  }

  const { db } = getDb()

  // A sub-wallet float has no end-user externalId; the label identifies the agent.
  const externalId = source.kind === 'user' ? source.externalId : source.label

  // Re-derive totals with CURRENT fee config — quote_stale on drift, so the
  // user always confirms the live price, never a stale one.
  const [partnerRow] = await db
    .select({ feePercent: partners.feePercent, treasuryWalletAddress: partners.treasuryWalletAddress })
    .from(partners)
    .where(eq(partners.id, partner.id))
    .limit(1)
  const partnerFeePercentRaw = partnerRow ? parseFloat(String(partnerRow.feePercent ?? '0')) : 0
  const feePercent = partnerFeePercentRaw > 0 ? partnerFeePercentRaw : DEFAULT_PLATFORM_FEE_PERCENT
  const feeRecipient = ethers.isAddress(partnerRow?.treasuryWalletAddress ?? '')
    ? partnerRow!.treasuryWalletAddress!
    : ethers.isAddress(PLATFORM_TREASURY_ADDRESS)
      ? PLATFORM_TREASURY_ADDRESS
      : null

  const totals = computeSpendTotals(kind, principalTzs, feePercent, utilityCode)
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
  const { burnAmountTzs, platformFeeTzs, selcomFeeTzs, nedaFeeTzs } = totals
  // NEDA protocol fee → the platform (NEDA) treasury, always — never the partner's.
  const nedaRecipient = ethers.isAddress(PLATFORM_TREASURY_ADDRESS) ? PLATFORM_TREASURY_ADDRESS : null

  // Spends above the safe threshold are an ops flow, not an API flow.
  if (burnAmountTzs >= SAFE_BURN_THRESHOLD_TZS) {
    return NextResponse.json(
      { error: 'amount_too_large', message: `Spends of ${SAFE_BURN_THRESHOLD_TZS.toLocaleString('en-US')} TZS or more require operations assistance.` },
      { status: 400 }
    )
  }

  // Caps (applied to nTZS burned)
  // One call enforces BoT Parameters #3/#4/#5 AND records the block —
  // evidence cannot be forgotten at a call site.
  const limitErr = await enforceSandboxLimits(source.subject, burnAmountTzs, {
    endpoint: 'v1/spend', stage: 'execute', partnerId: partner.id,
  })
  if (limitErr) return NextResponse.json(limitErrorResponse(limitErr), { status: 400 })

  if (!BASE_RPC_URL || !NTZS_CONTRACT_ADDRESS_BASE) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, NTZS_BALANCE_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(source.address)
    const balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))
    if (balanceTzs < burnAmountTzs) {
      return NextResponse.json(
        {
          error: 'insufficient_balance',
          message: `Insufficient balance. Available: ${balanceTzs} TZS, need ${burnAmountTzs} TZS to pay ${principalTzs} TZS (incl. fees).`,
          details: { available: balanceTzs, required: burnAmountTzs, principalTzs, selcomFeeTzs, platformFeeTzs },
        },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[v1/spend] Balance check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to verify balance' }, { status: 500 })
  }

  const burnerKey = BURNER_PRIVATE_KEY || MINTER_PRIVATE_KEY
  if (!burnerKey) {
    return NextResponse.json({ error: 'Burn executor not configured' }, { status: 500 })
  }

  // ── Refuse an accidental repeat BEFORE burning anything ───────────────────
  // Placed here on purpose: past this point the customer's nTZS is destroyed,
  // so a duplicate detected later is a refund conversation rather than a
  // prevented mistake. `allowDuplicate` lets a client proceed deliberately.
  if (body.allowDuplicate !== true) {
    try {
      const dup = await findDuplicateSpend({
        burnFromAddress: source.address,
        target: spendTarget(kind, { payNumber, utilityCode, utilityRef }),
        burnAmountTzs,
      })
      if (dup) {
        console.warn('[v1/spend] duplicate spend refused', {
          existing: dup.burnRequestId, reference: dup.reference, status: dup.payoutStatus,
        })
        return NextResponse.json(duplicateSpendResponse(dup, DUPLICATE_WINDOW_MS), { status: 409 })
      }
    } catch (err) {
      // Fail OPEN: this guard prevents a mistake, it is not an authorisation
      // decision, and a lookup failure must not block a legitimate payment.
      console.error('[v1/spend] duplicate check failed — proceeding', err instanceof Error ? err.message : err)
    }
  }

  // ── Create the burn row (spend descriptor + disclosure snapshot) ──────────
  const spendDescriptor = {
    kind,
    ...(kind === 'lipa' ? { payNumber, ...(network ? { network } : {}) } : { utilityCode, utilityRef }),
    recipientName: q.recipientName,
    principalTzs,
    selcomFeeEstimateTzs: selcomFeeTzs,
    // Partner link for the spend.updated webhook — carried in the descriptor
    // so the settlement cron can notify without a schema change.
    partnerId: partner.id,
    externalId,
    ...(source.kind === 'sub_wallet' ? { subWalletId: source.subWalletId, agentFloat: true } : {}),
  }

  const [burn] = await db
    .insert(burnRequests)
    .values({
      // For a sub-wallet float these two are record-keeping FKs only (the
      // columns are NOT NULL); burnFromAddress is the real source of funds and
      // subWalletId is the participant the sandbox caps are counted against.
      userId: source.userId,
      walletId: source.walletId,
      burnFromAddress: source.address,
      ...(source.kind === 'sub_wallet' ? { subWalletId: source.subWalletId } : {}),
      chain: 'base',
      contractAddress: NTZS_CONTRACT_ADDRESS_BASE,
      amountTzs: burnAmountTzs,
      reason: `WaaS spend (${kind})`,
      status: 'burn_submitted',
      requestedByUserId: source.userId,
      platformFeeTzs,
      nedaFeeTzs,
      payoutProvider: 'selcom',
      pspFeeTzs: selcomFeeTzs,
      payoutKind: kind,
      spend: spendDescriptor,
    })
    .returning({ id: burnRequests.id, amountTzs: burnRequests.amountTzs })
  if (!burn) {
    return NextResponse.json({ error: 'Failed to create spend request' }, { status: 500 })
  }
  const burnRequestId = burn.id

  // ── Burn on-chain (identical to the withdrawal path) ──────────────────────
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const signer = new ethers.Wallet(burnerKey, provider)
    const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, NTZS_BURN_ABI, signer)

    const burnerRole: string = await token.BURNER_ROLE()
    const hasBurner: boolean = await token.hasRole(burnerRole, await signer.getAddress())
    if (!hasBurner) {
      await db.update(burnRequests).set({ status: 'failed', error: 'Burn key lacks BURNER_ROLE', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
      return NextResponse.json({ error: 'Burn executor not configured correctly' }, { status: 500 })
    }

    const amountWei = BigInt(String(burnAmountTzs)) * BigInt(10) ** BigInt(18)
    const tx = await token.burn(source.address, amountWei)
    await db.update(burnRequests).set({ txHash: tx.hash, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    await tx.wait(1)
    await db.update(burnRequests).set({ status: 'burned', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))

    // Mint platform fee to partner-or-global treasury (best-effort)
    if (platformFeeTzs > 0 && feeRecipient) {
      try {
        const feeAmountWei = BigInt(platformFeeTzs) * BigInt(10) ** BigInt(18)
        const feeTx = await token.mint(feeRecipient, feeAmountWei)
        await feeTx.wait(1)
        await db
          .update(burnRequests)
          .set({ feeTxHash: feeTx.hash, feeRecipientAddress: feeRecipient, updatedAt: new Date() })
          .where(eq(burnRequests.id, burnRequestId))
      } catch (feeErr) {
        console.error('[v1/spend] fee mint failed (non-fatal):', feeErr instanceof Error ? feeErr.message : feeErr)
      }
    }

    // Mint the NEDA protocol fee to the platform (NEDA) treasury — the rail
    // operator's earn. Best-effort; with no treasury it stays reserve surplus.
    if (nedaFeeTzs > 0 && nedaRecipient) {
      try {
        const nedaTx = await token.mint(nedaRecipient, BigInt(nedaFeeTzs) * BigInt(10) ** BigInt(18))
        await nedaTx.wait(1)
        await db
          .update(burnRequests)
          .set({ nedaFeeTxHash: nedaTx.hash, updatedAt: new Date() })
          .where(eq(burnRequests.id, burnRequestId))
      } catch (feeErr) {
        console.error('[v1/spend] NEDA fee mint failed (non-fatal):', feeErr instanceof Error ? feeErr.message : feeErr)
      }
    } else if (nedaFeeTzs > 0) {
      console.warn('[v1/spend] no platform treasury — NEDA protocol fee kept as reserve surplus', { burnRequestId, nedaFeeTzs })
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.update(burnRequests).set({ status: 'failed', error: errorMessage, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    console.error('[v1/spend] Burn failed:', errorMessage)
    return NextResponse.json({ error: 'Burn failed', detail: errorMessage }, { status: 500 })
  }

  const [feeRow] = await db
    .select({ feeTxHash: burnRequests.feeTxHash, nedaFeeTxHash: burnRequests.nedaFeeTxHash })
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  // ── Dispatch the Selcom payment via the shared money-path ─────────────────
  // Same helper the ramp off-ramp uses: idempotent transId persisted before
  // dispatch, awaited quick poll, claim-once revert on decisive failure,
  // reconcile_required on ambiguity, spend.updated webhook on terminal state.
  const dispatch = await dispatchSpendPayment({
    burnRequestId,
    kind,
    principalTzs,
    payNumber,
    network,
    utilityCode,
    utilityRef,
    spendDescriptor,
    burnAmountTzs,
    revert: {
      // Revert re-mints to the SOURCE of funds — the agent float for a
      // sub-wallet spend, the user's wallet otherwise.
      userAddress: source.address,
      burnAmountTzs,
      platformFeeTzs,
      feeRecipientAddress: feeRecipient,
      feeMintOccurred: Boolean(feeRow?.feeTxHash),
      nedaFeeTzs,
      nedaFeeRecipientAddress: nedaRecipient,
      nedaFeeMintOccurred: Boolean(feeRow?.nedaFeeTxHash),
    },
    label: 'v1/spend',
    // Whatever remains of the response budget after the burn — never a fixed
    // ladder that can overrun the route's own limit.
    pollDeadlineMs: startedAt + RESPONSE_BUDGET_MS,
  })

  if (dispatch.payoutStatus === 'reverted') {
    return NextResponse.json(
      { id: burnRequestId, status: 'failed', payoutStatus: 'reverted', error: dispatch.error || 'Payment failed; burn reverted — balance restored.' },
      { status: 502 }
    )
  }
  if (dispatch.payoutStatus === 'reconcile_required') {
    return NextResponse.json(
      {
        id: burnRequestId,
        status: 'failed',
        payoutStatus: 'reconcile_required',
        error: dispatch.error || 'Payment could not be confirmed',
        message:
          'Spend is under review. The burn completed but Selcom did not confirm the payment. Do not retry — an operator will confirm and either complete the payment or restore the balance.',
      },
      { status: 502 }
    )
  }

  return NextResponse.json(
    {
      id: burnRequestId,
      status: 'burned',
      payoutStatus: dispatch.payoutStatus,
      reference: dispatch.reference,
      kind,
      target: kind === 'lipa' ? { payNumber, network: network ?? null } : { utilityCode, utilityRef },
      recipientName: q.recipientName,
      principalTzs,
      burnAmountTzs,
      fees: { selcomFeeTzs, platformFeeTzs, nedaFeeTzs, totalFeeTzs: selcomFeeTzs + platformFeeTzs + nedaFeeTzs },
      // When the awaited poll saw settlement, the voucher rides the same
      // response — for LUKU the token IS the product, and a client that only
      // gets it here never needs the webhook to make the customer whole.
      ...(typeof dispatch.settledDescriptor.utilityToken === 'string'
        ? {
            utilityToken: dispatch.settledDescriptor.utilityToken,
            ...(typeof dispatch.settledDescriptor.utilityUnits === 'string'
              ? { utilityUnits: dispatch.settledDescriptor.utilityUnits }
              : {}),
          }
        : {}),
      message: `Payment of ${principalTzs} TZS dispatched${q.recipientName ? ` to ${q.recipientName}` : ''} (${selcomFeeTzs + platformFeeTzs + nedaFeeTzs} TZS in fees).`,
    },
    { status: 201 }
  )
}
