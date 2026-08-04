import { eq, and, or, ne, gte, isNull, desc, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, BURNER_PRIVATE_KEY, PLATFORM_TREASURY_ADDRESS } from '@/lib/env'
import { isTestMode, testCreateWithdrawal } from '@/lib/testmode'
import { authenticatePartner } from '@/lib/waas/auth'
import { fundingSourceKey, resolveFundingSource } from '@/lib/waas/funding-source'
import {
  anyDisbursementRailConfigured,
  isValidTanzanianPhone,
  normalizePhone,
  sendPayoutRouted,
  checkPayoutStatusFor,
  lookupRecipientName,
  expectedPayoutFeeTzs,
} from '@/lib/psp'
import { railLabel, getPayoutFeeTzs } from '@/lib/psp/selcom-fees'
import { BANK_FI_CODES, nedaAccountLookup, sendBankPayout as selcomSendBankPayout } from '@/lib/psp/selcom'
import { resolveBankDestination, maskAccount } from '@/lib/waas/bank-destination'
import { enforceSandboxLimits, limitErrorResponse } from '@/lib/sandbox/limits'
import { payoutRailsLookDead, CIRCUIT_OPEN_RESPONSE } from '@/lib/psp/payout-circuit'
import { burnRequests, partners } from '@ntzs/db'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'
import {
  computeWithdrawalGrossUp,
  verifyQuoteToken,
  quoteRequired,
  DEFAULT_PLATFORM_FEE_PERCENT,
} from '@/lib/waas/quote'
import { SAFE_BURN_THRESHOLD_TZS } from '@/lib/approvals/thresholds'

const APP_URL = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''

const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const
const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

/**
 * POST /api/v1/withdrawals — Initiate nTZS burn + Snippe payout to M-Pesa (off-ramp)
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult

  // TEST MODE: simulated burn + payout, real fee math and real quote checks.
  if (isTestMode(partner)) return testCreateWithdrawal(partner, request)

  let body: { userId?: string; subWalletId?: string; amountTzs: number; phoneNumber?: string; bankCode?: string; accountNumber?: string; quoteId?: string; allowDuplicate?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { amountTzs: receiveAmountRaw, phoneNumber, quoteId } = body

  // Destination: a mobile wallet (phoneNumber) OR a bank account (banking
  // phase 2) — exactly one.
  const bank = resolveBankDestination(body)
  if (bank && 'error' in bank) return NextResponse.json({ error: bank.error }, { status: bank.status })
  if (!receiveAmountRaw || (!phoneNumber && !bank)) {
    return NextResponse.json(
      { error: 'amountTzs and a destination are required: phoneNumber (mobile money) OR bankCode + accountNumber (bank)' },
      { status: 400 }
    )
  }
  if (phoneNumber && bank) {
    return NextResponse.json({ error: 'Provide exactly one destination: phoneNumber OR bankCode + accountNumber' }, { status: 400 })
  }

  // amountTzs in the request is the amount the recipient should RECEIVE.
  const receiveAmountTzs = Math.trunc(Number(receiveAmountRaw))
  if (!Number.isFinite(receiveAmountTzs) || receiveAmountTzs < 5000) {
    return NextResponse.json(
      { error: 'Minimum withdrawal amount is 5,000 TZS (recipient net)' },
      { status: 400 }
    )
  }

  if (phoneNumber && !isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json(
      { error: 'Invalid Tanzanian phone number' },
      { status: 400 }
    )
  }
  // Banks are Selcom-only (single-rail) — refuse before money moves when the
  // rail is off, exactly like the quote does.
  if (bank && process.env.SELCOM_DISBURSEMENTS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'bank_rail_unavailable', message: 'Bank payouts are not enabled on this environment yet.' }, { status: 503 })
  }

  const { db } = getDb()

  // The user's wallet, or — for agent-float partners — a partner sub-wallet.
  const funding = await resolveFundingSource(partner, body)
  if ('error' in funding) return funding.error
  const { source } = funding

  // Load partner fee config + treasury
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
  // NEDA protocol fee → the platform (NEDA) treasury, always — never the partner's.
  const nedaRecipient = ethers.isAddress(PLATFORM_TREASURY_ADDRESS) ? PLATFORM_TREASURY_ADDRESS : null

  // Gross-up: burnAmount = ceil((receive + pspFee) / (1 - feeRate)) + nedaFee
  // — shared with the quote endpoint so quotes price exactly what executes.
  // The PSP fee is the expected serving rail's charge, not a flat constant;
  // a rail flip between quote and execute surfaces as quote_stale below.
  // Banks are always Selcom (same send-money tariff as wallets).
  const pspFeeTzs = bank ? getPayoutFeeTzs('selcom', receiveAmountTzs) : expectedPayoutFeeTzs(receiveAmountTzs)
  const { burnAmountTzs, platformFeeTzs, nedaFeeTzs } = computeWithdrawalGrossUp(receiveAmountTzs, feePercent, pspFeeTzs)

  // ── Quote verification (the name+fee disclosure contract) ─────────────────
  // A valid quoteId proves the client fetched recipient name + fee breakdown
  // for THESE terms within the last 5 minutes. Optional until partners adopt;
  // WAAS_REQUIRE_QUOTE=true makes it mandatory.
  if (quoteId) {
    const v = verifyQuoteToken(quoteId)
    if (!v.ok) {
      return NextResponse.json(
        { error: 'invalid_quote', reason: v.reason, message: 'Quote is invalid or expired — request a new one via POST /api/v1/withdrawals/quote.' },
        { status: 400 }
      )
    }
    const q = v.payload
    const quoteSrc = q.src ?? `user:${q.userId}`
    const destinationMatches = bank
      ? Boolean(q.bank && q.bank.code === bank.code && q.bank.account === bank.account)
      : !q.bank && q.phone === normalizePhone(phoneNumber!)
    if (q.partnerId !== partner.id || quoteSrc !== fundingSourceKey(source) || !destinationMatches || q.receiveAmountTzs !== receiveAmountTzs) {
      return NextResponse.json(
        { error: 'quote_mismatch', message: 'Quote was issued for different terms (user/destination/amount). Request a new quote.' },
        { status: 400 }
      )
    }
    if (q.burnAmountTzs !== burnAmountTzs) {
      // Fee config changed between quote and execute — force a re-quote so
      // the user confirms the CURRENT price, never a stale one.
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

  // BoT Parameters #3/#4/#5 — enforced AND recorded in one call, so
  // evidence of the control binding cannot be forgotten at a call site.
  const limitErr = await enforceSandboxLimits(source.subject, burnAmountTzs, {
    endpoint: 'v1/withdrawals', stage: 'execute', partnerId: partner.id,
  })
  if (limitErr) {
    return NextResponse.json(limitErrorResponse(limitErr), { status: 400 })
  }

  // Duplicate guard — same source, same phone, same amount within 5 minutes.
  // On 1 Aug 2026 a user whose payout initiation failed retried and burned
  // TWICE for one intended cash-out: the "do not retry" message asked, but
  // nothing enforced it. (The identical guard already protects Spend.) The
  // repeat pattern is also what PSP risk engines read as structuring. A
  // deliberate repeat passes allowDuplicate: true.
  if (body.allowDuplicate !== true) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    const [dup] = await db
      .select({
        id: burnRequests.id,
        status: burnRequests.status,
        payoutStatus: burnRequests.payoutStatus,
        payoutError: burnRequests.payoutError,
        createdAt: burnRequests.createdAt,
      })
      .from(burnRequests)
      .where(and(
        eq(burnRequests.burnFromAddress, source.address),
        // Same destination: the phone for wallet payouts, the bank account
        // (persisted in the spend descriptor) for bank payouts.
        bank
          ? and(eq(burnRequests.payoutKind, 'bank'), sql`${burnRequests.spend}->>'accountNumber' = ${bank.account}`)
          : eq(burnRequests.recipientPhone, phoneNumber!),
        eq(burnRequests.amountTzs, burnAmountTzs),
        gte(burnRequests.createdAt, fiveMinAgo),
        // Money still committed: anything except a burn that never happened
        // or one already returned to the user.
        ne(burnRequests.status, 'failed'),
        or(isNull(burnRequests.payoutStatus), ne(burnRequests.payoutStatus, 'reverted')),
      ))
      .orderBy(desc(burnRequests.createdAt))
      .limit(1)
    if (dup) {
      return NextResponse.json(
        {
          error: 'duplicate_withdrawal',
          message:
            'An identical withdrawal from this wallet to this destination was made moments ago and is still holding funds. Do not retry — check its status. To deliberately withdraw the same amount again, resend with "allowDuplicate": true.',
          existing: { id: dup.id, status: dup.status, payoutStatus: dup.payoutStatus, payoutError: dup.payoutError, createdAt: dup.createdAt },
        },
        { status: 409 },
      )
    }
  }

  // Circuit breaker — when the rails are evidently refusing initiations,
  // refuse BEFORE the burn (1 Aug 2026: retries against dead rails burned
  // six times with nothing dispatched; balance-untouched 503 is the honest
  // failure).
  const circuit = await payoutRailsLookDead()
  if (circuit.dead) {
    console.warn('[v1/withdrawals] circuit open — refusing pre-burn:', circuit.reason)
    return NextResponse.json(CIRCUIT_OPEN_RESPONSE, { status: 503 })
  }

  // Check on-chain balance
  const rpcUrl = BASE_RPC_URL
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(contractAddress, NTZS_BALANCE_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(source.address)
    const balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))

    if (balanceTzs < burnAmountTzs) {
      return NextResponse.json(
        {
          error: 'insufficient_balance',
          message: `Insufficient balance. Available: ${balanceTzs} TZS, need ${burnAmountTzs} TZS to pay out ${receiveAmountTzs} TZS (incl. fees).`,
          details: { available: balanceTzs, required: burnAmountTzs, receiveAmountTzs, platformFeeTzs, pspFeeTzs },
        },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[v1/withdrawals] Balance check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to verify balance' }, { status: 500 })
  }

  // Large amounts require admin approval — queue and return
  if (burnAmountTzs >= SAFE_BURN_THRESHOLD_TZS) {
    // The approval queue dispatches through the burn engine, which pays
    // mobile wallets only — a queued bank row would burn and then strand.
    // Refuse honestly until the engine learns banks.
    if (bank) {
      return NextResponse.json(
        { error: 'bank_amount_unsupported', message: `Bank withdrawals at or above ${SAFE_BURN_THRESHOLD_TZS.toLocaleString('en-US')} TZS (gross) are not supported yet — split into smaller withdrawals.` },
        { status: 400 }
      )
    }
    const [burn] = await db
      .insert(burnRequests)
      .values({
        // Record-keeping FKs for a sub-wallet float; burnFromAddress is the
        // real source and subWalletId is the cap subject.
        userId: source.userId,
        walletId: source.walletId,
        burnFromAddress: source.address,
        ...(source.kind === 'sub_wallet' ? { subWalletId: source.subWalletId } : {}),
        chain: 'base',
        contractAddress,
        amountTzs: burnAmountTzs,
        reason: 'WaaS withdrawal',
        status: 'requested',
        requestedByUserId: source.userId,
        recipientPhone: phoneNumber,
        platformFeeTzs,
        nedaFeeTzs,
        // What the gross-up charged for the PSP leg — the burn engine backs
        // this exact figure out when it dispatches after approval.
        pspFeeTzs,
      })
      .returning({ id: burnRequests.id, status: burnRequests.status, amountTzs: burnRequests.amountTzs })

    if (!burn) {
      return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
    }

    return NextResponse.json(
      {
        id: burn.id,
        status: burn.status,
        amountTzs: burn.amountTzs,
        receiveAmountTzs,
        platformFeeTzs,
        pspFeeTzs,
        nedaFeeTzs,
        message: 'Withdrawal requires admin approval for amounts >= 1,000,000 TZS.',
      },
      { status: 201 }
    )
  }

  // Small amounts: execute burn inline immediately
  const burnerKey = BURNER_PRIVATE_KEY || MINTER_PRIVATE_KEY
  if (!burnerKey) {
    return NextResponse.json({ error: 'Burn executor not configured' }, { status: 500 })
  }

  // Create burn request in burn_submitted state
  const [burn] = await db
    .insert(burnRequests)
    .values({
      userId: source.userId,
      walletId: source.walletId,
      burnFromAddress: source.address,
      ...(source.kind === 'sub_wallet' ? { subWalletId: source.subWalletId } : {}),
      chain: 'base',
      contractAddress,
      amountTzs: burnAmountTzs,
      reason: 'WaaS withdrawal',
      status: 'burn_submitted',
      requestedByUserId: source.userId,
      recipientPhone: bank ? null : phoneNumber,
      platformFeeTzs,
      nedaFeeTzs,
      pspFeeTzs,
      ...(bank
        ? {
            // Bank rows reuse the spend-descriptor pattern (payout_kind +
            // jsonb) — no schema change; the reconcile surfaces and GET /:id
            // read the destination from here.
            payoutKind: 'bank',
            payoutProvider: 'selcom' as const,
            spend: { kind: 'bank', bankCode: bank.code, accountNumber: bank.account, bankName: BANK_FI_CODES[bank.code].name },
          }
        : {}),
    })
    .returning({ id: burnRequests.id, amountTzs: burnRequests.amountTzs })

  if (!burn) {
    return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
  }

  const burnRequestId = burn.id

  // Execute burn on-chain
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const signer = new ethers.Wallet(burnerKey, provider)
    const token = new ethers.Contract(contractAddress, NTZS_BURN_ABI, signer)

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

    // ── Mint platform fee to partner-or-global treasury (best-effort) ──────
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
        const msg = feeErr instanceof Error ? feeErr.message : String(feeErr)
        console.error('[v1/withdrawals] fee mint failed (non-fatal):', msg)
      }
    } else if (platformFeeTzs > 0) {
      console.warn('[v1/withdrawals] no treasury address configured — platform fee kept as implicit reserve surplus', { burnRequestId, platformFeeTzs })
    }

    // ── Mint the NEDA protocol fee to the platform (NEDA) treasury ──────────
    if (nedaFeeTzs > 0 && nedaRecipient) {
      try {
        const nedaTx = await token.mint(nedaRecipient, BigInt(nedaFeeTzs) * BigInt(10) ** BigInt(18))
        await nedaTx.wait(1)
        await db
          .update(burnRequests)
          .set({ nedaFeeTxHash: nedaTx.hash, updatedAt: new Date() })
          .where(eq(burnRequests.id, burnRequestId))
      } catch (nedaErr) {
        console.error('[v1/withdrawals] NEDA fee mint failed (non-fatal):', nedaErr instanceof Error ? nedaErr.message : nedaErr)
      }
    } else if (nedaFeeTzs > 0) {
      console.warn('[v1/withdrawals] no platform treasury — NEDA protocol fee kept as reserve surplus', { burnRequestId, nedaFeeTzs })
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.update(burnRequests).set({ status: 'failed', error: errorMessage, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    console.error('[v1/withdrawals] Burn failed:', errorMessage)
    return NextResponse.json({ error: 'Burn failed', detail: errorMessage }, { status: 500 })
  }

  // Track whether the platform / NEDA fees were actually minted so a later
  // revert knows whether to burn them back.
  const feeMintedRef = { occurred: false }
  const nedaFeeMintedRef = { occurred: false }

  // Re-read flags from DB (the mint blocks above only set them conditionally).
  {
    const [row] = await db
      .select({ feeTxHash: burnRequests.feeTxHash, nedaFeeTxHash: burnRequests.nedaFeeTxHash })
      .from(burnRequests)
      .where(eq(burnRequests.id, burnRequestId))
      .limit(1)
    feeMintedRef.occurred = Boolean(row?.feeTxHash)
    nedaFeeMintedRef.occurred = Boolean(row?.nedaFeeTxHash)
  }

  // Helper: transition payoutStatus 'pending' → 'reverted' atomically.
  // Returns true if we were the one that flipped it (i.e. caller should
  // perform the revert on-chain). Guards against double-revert if both the
  // polling loop and the webhook fire.
  const claimRevert = async (): Promise<boolean> => {
    const updated = await db
      .update(burnRequests)
      .set({ payoutStatus: 'reverting', updatedAt: new Date() })
      .where(
        and(
          eq(burnRequests.id, burnRequestId),
          // Only claim if no one has already finalized this payout.
          // payoutStatus is text, so compare against the known non-final states.
          or(
            eq(burnRequests.payoutStatus, 'pending'),
            eq(burnRequests.payoutStatus, 'failed'),
          ),
        )
      )
      .returning({ id: burnRequests.id })
    return updated.length > 0
  }

  const finalizeRevert = async (reason: string, remintTxHash?: string, feeBurnTxHash?: string, remintError?: string) => {
    await db
      .update(burnRequests)
      .set({
        status: 'failed',
        payoutStatus: remintError ? 'reconcile_required' : 'reverted',
        payoutError: remintError ? `${reason} | remint_error: ${remintError}` : reason,
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))
    console.log('[v1/withdrawals] burn reverted', {
      burnRequestId, reason, remintTxHash, feeBurnTxHash, remintError,
    })
  }

  const revertBurnForUser = async (reason: string) => {
    const claimed = await claimRevert()
    if (!claimed) return // already finalized by another path
    const res = await revertOffRampBurn({
      burnRequestId,
      // Revert re-mints to the SOURCE of funds — the agent float for a
      // sub-wallet withdrawal, the user's wallet otherwise.
      userAddress: source.address,
      burnAmountTzs,
      platformFeeTzs,
      feeRecipientAddress: feeRecipient,
      feeMintOccurred: feeMintedRef.occurred,
      nedaFeeTzs,
      nedaFeeRecipientAddress: nedaRecipient,
      nedaFeeMintOccurred: nedaFeeMintedRef.occurred,
      reason,
    })
    await finalizeRevert(reason, res.remintTxHash, res.feeBurnTxHash, res.error)
  }

  // Trigger the payout with RAIL FAILOVER. Cash-outs used to ride a single
  // PSP (plain sendPayout): on 1 Aug 2026 Snippe flagged our merchant account
  // and refused every initiation, so every user withdrawal died in
  // reconcile_required while Selcom sat configured and untried. The routed
  // dispatcher walks DISBURSEMENT_RAIL_PRIORITY and each attempt carries its
  // own rail's webhook URL.
  let verifiedRecipientName: string | null = null
  // Captured for the response's confirmation block — the partner app relays
  // this to the withdrawing user (the PSP's own confirmation SMS goes only to
  // the corporate account, never to them).
  let dispatchedRail: string | null = null
  let dispatchedRef: string | null = null
  let dispatchedReceipt: string | null = null
  if (bank) {
    // ── Bank leg (banking phase 2) — Selcom single-rail ─────────────────────
    // Registered-name lookup first (disclosure + the transfer carries the
    // real name); non-fatal, and skipped for lookup-disabled banks (BoT).
    if (BANK_FI_CODES[bank.code].lookup) {
      const info = await nedaAccountLookup(bank.code, bank.account).catch(() => ({ name: null as string | null }))
      if (info.name) verifiedRecipientName = info.name
    }
    try {
      const dispatchResult = await selcomSendBankPayout({
        amountTzs: receiveAmountTzs,
        bankName: bank.code,
        bankAccount: bank.account,
        recipientName: verifiedRecipientName || 'nTZS User',
        narration: 'nTZS withdrawal',
        webhookUrl: `${APP_URL}/api/webhooks/selcom/payout`,
        metadata: { burn_request_id: burnRequestId },
      })
      if (dispatchResult.success && dispatchResult.reference) {
        dispatchedRail = 'selcom'
        dispatchedRef = dispatchResult.reference
        dispatchedReceipt = dispatchResult.externalReference ?? null
        await db.update(burnRequests)
          .set({
            payoutReference: dispatchResult.reference,
            payoutStatus: 'pending',
            spend: { kind: 'bank', bankCode: bank.code, accountNumber: bank.account, bankName: BANK_FI_CODES[bank.code].name, recipientName: verifiedRecipientName },
            updatedAt: new Date(),
          })
          .where(eq(burnRequests.id, burnRequestId))
        // Bounded poll — same latency posture as wallets; the Selcom payout
        // webhook and the recheck surfaces finish the slow tail.
        for (const delay of [2500, 4000]) {
          await new Promise((r) => setTimeout(r, delay))
          try {
            const ps = await checkPayoutStatusFor('selcom', dispatchResult.reference)
            if (ps.status === 'completed') {
              await db.update(burnRequests)
                .set({ payoutStatus: 'completed', status: 'burned', updatedAt: new Date() })
                .where(eq(burnRequests.id, burnRequestId))
              break
            }
            if (ps.status === 'failed' || ps.status === 'reversed') {
              await revertBurnForUser(ps.failureReason || 'Bank payout failed')
              break
            }
          } catch { /* keep polling */ }
        }
      } else {
        // Single-rail refusal: same no-auto-revert doctrine as wallets — an
        // initiation failure is ambiguous until the PSP's records say so.
        const reason = `${dispatchResult.error ?? 'Bank payout initiation failed'} (rail: selcom — banks are single-rail)`
        console.error('[v1/withdrawals] Bank payout initiation failed (NOT auto-reverting):', reason)
        await db.update(burnRequests)
          .set({ payoutStatus: 'reconcile_required', payoutError: reason, updatedAt: new Date() })
          .where(eq(burnRequests.id, burnRequestId))
      }
    } catch (payoutErr) {
      const msg = payoutErr instanceof Error ? payoutErr.message : String(payoutErr)
      console.error('[v1/withdrawals] Bank payout error (NOT auto-reverting):', msg)
      await db.update(burnRequests)
        .set({ payoutStatus: 'reconcile_required', payoutError: msg, updatedAt: new Date() })
        .where(eq(burnRequests.id, burnRequestId))
    }
  } else if (anyDisbursementRailConfigured()) {
    const phone = normalizePhone(phoneNumber!)

    // Name lookup — non-fatal, result stored for audit trail
    const recipientInfo = await lookupRecipientName(phone)
    if (recipientInfo.name) {
      verifiedRecipientName = recipientInfo.name
      console.log(`[v1/withdrawals] Recipient name verified: ${recipientInfo.name} (${phone})`)
    }

    try {
      const routed = await sendPayoutRouted({
        amountTzs: receiveAmountTzs,
        recipientPhone: phone,
        recipientName: recipientInfo.name || 'nTZS User',
        narration: 'nTZS withdrawal',
        webhookBaseUrl: APP_URL,
        metadata: { burn_request_id: burnRequestId },
      })

      if (routed.payout.success && routed.payout.reference) {
        const payoutRef = routed.payout.reference
        const payoutRail = routed.provider
        dispatchedRail = payoutRail
        dispatchedRef = payoutRef
        // Selcom returns its own receipt number on initiation (the id printed
        // on the corporate confirmation SMS) — pass it through to the caller.
        dispatchedReceipt = routed.payout.externalReference ?? null
        // The serving rail is persisted because webhooks and status queries
        // are provider-scoped — a payout that failed over must be polled
        // where it actually went.
        await db.update(burnRequests)
          .set({ payoutReference: payoutRef, payoutProvider: payoutRail, payoutStatus: 'pending', updatedAt: new Date() })
          .where(eq(burnRequests.id, burnRequestId))

        // Poll the SERVING rail for quick completions — webhook is the primary path
        // Checks at 3s, 6s, 12s intervals
        void (async () => {
          const delays = [3000, 6000, 12000]
          for (const delay of delays) {
            await new Promise((r) => setTimeout(r, delay))
            try {
              const ps = await checkPayoutStatusFor(payoutRail, payoutRef)
              if (ps.status === 'completed') {
                await db.update(burnRequests)
                  .set({ payoutStatus: 'completed', status: 'burned', updatedAt: new Date() })
                  .where(eq(burnRequests.id, burnRequestId))
                console.log(`[v1/withdrawals] Payout ${payoutRef} completed via ${payoutRail} (polled)`)
                break
              } else if (ps.status === 'failed' || ps.status === 'reversed') {
                console.warn(`[v1/withdrawals] Payout ${payoutRef} failed via ${payoutRail} (polled): ${ps.failureReason}`)
                await revertBurnForUser(ps.failureReason || 'Payout failed (polled)')
                break
              }
            } catch {
              // Continue to next poll interval
            }
          }
        })()
      } else {
        // EVERY rail refused. We do NOT auto-revert — a failed initiation
        // is ambiguous (could be a clean reject or a partial dispatch).
        // Only signed webhook events or status-endpoint values are authoritative.
        // Mark for reconciliation and let an operator verify before touching funds.
        // The attempted-rail trail is part of the evidence.
        const reason = `${routed.payout.error ?? 'Payout initiation failed'} (rails tried: ${routed.attempted.join(' → ') || 'none'})`
        console.error('[v1/withdrawals] Payout initiation failed on every rail (NOT auto-reverting):', reason)
        await db
          .update(burnRequests)
          .set({ payoutStatus: 'reconcile_required', payoutError: reason, updatedAt: new Date() })
          .where(eq(burnRequests.id, burnRequestId))
      }
    } catch (payoutErr) {
      // Network / fetch exception — state is unknown. Same rule: no auto-revert.
      const msg = payoutErr instanceof Error ? payoutErr.message : String(payoutErr)
      console.error('[v1/withdrawals] Payout error (NOT auto-reverting):', msg)
      await db
        .update(burnRequests)
        .set({ payoutStatus: 'reconcile_required', payoutError: msg, updatedAt: new Date() })
        .where(eq(burnRequests.id, burnRequestId))
    }
  }

  // Re-read final state. Auto-reverts (polling loop) and reconcile-required
  // (ambiguous sync failure) both need to be surfaced to the caller.
  const [finalRow] = await db
    .select({
      status: burnRequests.status,
      payoutStatus: burnRequests.payoutStatus,
      payoutError: burnRequests.payoutError,
    })
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (finalRow?.payoutStatus === 'reverted') {
    return NextResponse.json(
      {
        id: burnRequestId,
        status: finalRow.status,
        payoutStatus: finalRow.payoutStatus,
        error: finalRow.payoutError || 'Payout failed; burn reverted.',
      },
      { status: 502 }
    )
  }

  if (finalRow?.payoutStatus === 'reconcile_required') {
    return NextResponse.json(
      {
        id: burnRequestId,
        status: finalRow.status,
        payoutStatus: finalRow.payoutStatus,
        error: finalRow.payoutError || 'Payout could not be dispatched',
        message:
          'Withdrawal is under review. On-chain burn completed but PSP did not confirm the payout. Do not retry — an operator will confirm with the PSP and either complete the payout or restore your balance.',
      },
      { status: 502 }
    )
  }

  // The user-facing confirmation. The PSP's own confirmation SMS goes only to
  // the corporate account; this string carries the same substance (who was
  // paid, how much, which rail, the reference) so the partner app can show or
  // push it to the withdrawing user verbatim.
  const destinationLabel = bank ? `${bank.code} ${maskAccount(bank.account)}` : normalizePhone(phoneNumber!)
  const confirmationMessage = dispatchedRef
    ? `TZS ${receiveAmountTzs.toLocaleString('en-US')} sent to ${verifiedRecipientName ?? 'the recipient'} (${destinationLabel}) via ${railLabel(dispatchedRail)} — ref ${dispatchedRef}${dispatchedReceipt ? `, receipt ${dispatchedReceipt}` : ''}.`
    : null

  return NextResponse.json(
    {
      id: burnRequestId,
      status: 'burned',
      amountTzs: burn.amountTzs,
      receiveAmountTzs,
      ...(bank ? { bankCode: bank.code, bankName: BANK_FI_CODES[bank.code].name, accountNumber: bank.account } : {}),
      recipientName: verifiedRecipientName,
      platformFeeTzs,
      pspFeeTzs,
      nedaFeeTzs,
      totalFeeTzs: platformFeeTzs + pspFeeTzs + nedaFeeTzs,
      feeRecipient,
      payoutRail: dispatchedRail,
      payoutReference: dispatchedRef,
      payoutReceipt: dispatchedReceipt,
      payoutStatus: finalRow?.payoutStatus ?? null,
      confirmationMessage,
      message: `Withdrawal processed: ${receiveAmountTzs} TZS on its way to the recipient (${platformFeeTzs + pspFeeTzs + nedaFeeTzs} TZS in fees).`,
    },
    { status: 201 }
  )
}
