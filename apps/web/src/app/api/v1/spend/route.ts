import { eq, and, or } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, BURNER_PRIVATE_KEY, PLATFORM_TREASURY_ADDRESS } from '@/lib/env'
import { authenticatePartner } from '@/lib/waas/auth'
import { payLipa, payBill, makeNumericTransId, queryTransactionRaw, checkPayoutStatus as selcomPayoutStatus } from '@/lib/psp/selcom'
import { checkPerTransactionCap, checkUserPeriodLimits, limitErrorResponse } from '@/lib/sandbox/limits'
import { wallets, partnerUsers, burnRequests, partners } from '@ntzs/db'
import { revertOffRampBurn } from '@/lib/minting/revertOffRampBurn'
import {
  computeSpendTotals,
  verifySpendQuoteToken,
  spendEnabled,
  spendKindEnabled,
  spendTarget,
  DEFAULT_PLATFORM_FEE_PERCENT,
  type SpendKind,
} from '@/lib/waas/spend-quote'

const SAFE_MINT_THRESHOLD_TZS = 1000000

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
    quoteId?: string
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

  const { userId, quoteId, kind } = body
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
  const payNumber = body.payNumber ? String(body.payNumber).replace(/\s+/g, '') : undefined
  const network = body.network?.trim() || undefined
  const utilityCode = body.utilityCode ? String(body.utilityCode).trim().toUpperCase() : undefined
  const utilityRef = body.utilityRef ? String(body.utilityRef).trim() : undefined
  const target = spendTarget(kind, { payNumber, utilityCode, utilityRef })

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
  if (q.partnerId !== partner.id || q.userId !== userId || q.kind !== kind || q.target !== target || q.principalTzs !== principalTzs) {
    return NextResponse.json(
      { error: 'quote_mismatch', message: 'Quote was issued for different terms (user/destination/amount). Request a new quote.' },
      { status: 400 }
    )
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
  if (q.burnAmountTzs !== totals.burnAmountTzs || q.selcomFeeTzs !== totals.selcomFeeTzs || q.platformFeeTzs !== totals.platformFeeTzs) {
    return NextResponse.json(
      { error: 'quote_stale', message: 'Pricing changed since this quote was issued. Request a new quote.' },
      { status: 409 }
    )
  }
  const { burnAmountTzs, platformFeeTzs, selcomFeeTzs } = totals

  // Spends above the safe threshold are an ops flow, not an API flow.
  if (burnAmountTzs >= SAFE_MINT_THRESHOLD_TZS) {
    return NextResponse.json(
      { error: 'amount_too_large', message: `Spends of ${SAFE_MINT_THRESHOLD_TZS.toLocaleString('en-US')} TZS or more require operations assistance.` },
      { status: 400 }
    )
  }

  // Caps (applied to nTZS burned)
  const perTxnErr = checkPerTransactionCap(burnAmountTzs)
  if (perTxnErr) return NextResponse.json(limitErrorResponse(perTxnErr), { status: 400 })
  const periodErr = await checkUserPeriodLimits(userId, burnAmountTzs)
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

  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, NTZS_BALANCE_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(wallet.address)
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

  // ── Create the burn row (spend descriptor + disclosure snapshot) ──────────
  const spendDescriptor = {
    kind,
    ...(kind === 'lipa' ? { payNumber, ...(network ? { network } : {}) } : { utilityCode, utilityRef }),
    recipientName: q.recipientName,
    principalTzs,
    selcomFeeEstimateTzs: selcomFeeTzs,
  }

  const [burn] = await db
    .insert(burnRequests)
    .values({
      userId,
      walletId: wallet.id,
      chain: 'base',
      contractAddress: NTZS_CONTRACT_ADDRESS_BASE,
      amountTzs: burnAmountTzs,
      reason: `WaaS spend (${kind})`,
      status: 'burn_submitted',
      requestedByUserId: userId,
      platformFeeTzs,
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
    const tx = await token.burn(wallet.address, amountWei)
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
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.update(burnRequests).set({ status: 'failed', error: errorMessage, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    console.error('[v1/spend] Burn failed:', errorMessage)
    return NextResponse.json({ error: 'Burn failed', detail: errorMessage }, { status: 500 })
  }

  const feeMintedRef = { occurred: false }
  {
    const [row] = await db
      .select({ feeTxHash: burnRequests.feeTxHash })
      .from(burnRequests)
      .where(eq(burnRequests.id, burnRequestId))
      .limit(1)
    feeMintedRef.occurred = Boolean(row?.feeTxHash)
  }

  const claimRevert = async (): Promise<boolean> => {
    const updated = await db
      .update(burnRequests)
      .set({ payoutStatus: 'reverting', updatedAt: new Date() })
      .where(
        and(
          eq(burnRequests.id, burnRequestId),
          or(eq(burnRequests.payoutStatus, 'pending'), eq(burnRequests.payoutStatus, 'failed'))
        )
      )
      .returning({ id: burnRequests.id })
    return updated.length > 0
  }

  const finalizeRevert = async (reason: string, remintError?: string) => {
    await db
      .update(burnRequests)
      .set({
        status: 'failed',
        payoutStatus: remintError ? 'reconcile_required' : 'reverted',
        payoutError: remintError ? `${reason} | remint_error: ${remintError}` : reason,
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burnRequestId))
    console.log('[v1/spend] burn reverted', { burnRequestId, reason, remintError })
  }

  const revertBurnForUser = async (reason: string) => {
    const claimed = await claimRevert()
    if (!claimed) return
    const res = await revertOffRampBurn({
      burnRequestId,
      userAddress: wallet.address,
      burnAmountTzs,
      platformFeeTzs,
      feeRecipientAddress: feeRecipient,
      feeMintOccurred: feeMintedRef.occurred,
      reason,
    })
    await finalizeRevert(reason, res.error)
  }

  // ── Dispatch the Selcom payment ───────────────────────────────────────────
  // transId generated ONCE and persisted BEFORE dispatch: if we crash between
  // dispatch and the DB write, the reference is still on the row for the
  // reconciler; retries inside payLipa/payBill reuse it (idempotent at Selcom).
  const transId = makeNumericTransId()
  await db
    .update(burnRequests)
    .set({ payoutReference: transId, payoutStatus: 'pending', updatedAt: new Date() })
    .where(eq(burnRequests.id, burnRequestId))

  let dispatchOutcome: 'accepted' | 'failed_clean' | 'ambiguous' = 'ambiguous'
  let dispatchError: string | undefined
  try {
    const dispatch =
      kind === 'lipa'
        ? await payLipa({ payNumber: payNumber as string, network, amountTzs: principalTzs, transId })
        : await payBill({ utilityCode: utilityCode as string, utilityRef: utilityRef as string, amountTzs: principalTzs, transId })

    if (dispatch.success) {
      dispatchOutcome = 'accepted'
    } else {
      dispatchError = dispatch.error
      // Decisive vs ambiguous: ask the authoritative query. A FAILED (or
      // absent) transaction cannot pay out later → clean revert. Anything
      // else stays for the operator / status cron.
      const st = await selcomPayoutStatus(transId)
      dispatchOutcome = st.status === 'failed' ? 'failed_clean' : 'ambiguous'
    }
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : String(err)
    dispatchOutcome = 'ambiguous'
  }

  if (dispatchOutcome === 'failed_clean') {
    await revertBurnForUser(dispatchError || 'Selcom rejected the payment')
  } else if (dispatchOutcome === 'ambiguous' && dispatchError) {
    await db
      .update(burnRequests)
      .set({ payoutStatus: 'reconcile_required', payoutError: dispatchError, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
  } else if (dispatchOutcome === 'accepted') {
    // Quick completion poll — settlement measured at ~4s on the live rail.
    // The spend-status-sync cron is the durable path.
    void (async () => {
      const delays = [3000, 6000, 12000]
      for (const delay of delays) {
        await new Promise((r) => setTimeout(r, delay))
        try {
          const raw = await queryTransactionRaw(transId)
          if ('error' in raw) continue
          const status = String(raw.body.data?.status ?? '').toUpperCase()
          if (status === 'COMPLETED' || raw.body.result === 'SUCCESS') {
            const d = raw.body.data as Record<string, unknown> | undefined
            await db
              .update(burnRequests)
              .set({
                status: 'burned',
                payoutStatus: 'completed',
                spend: {
                  ...spendDescriptor,
                  actualChargesTzs: d?.totalCharges != null ? Number(d.totalCharges) : undefined,
                  selcomReceipt: typeof d?.selcomReceipt === 'string' ? d.selcomReceipt : undefined,
                },
                updatedAt: new Date(),
              })
              .where(eq(burnRequests.id, burnRequestId))
            console.log(`[v1/spend] ${transId} completed (polled)`)
            break
          }
          if (status === 'FAILED' || raw.body.result === 'FAIL') {
            await revertBurnForUser('Selcom payment failed (polled)')
            break
          }
        } catch {
          // next interval
        }
      }
    })()
  }

  const [finalRow] = await db
    .select({ status: burnRequests.status, payoutStatus: burnRequests.payoutStatus, payoutError: burnRequests.payoutError })
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (finalRow?.payoutStatus === 'reverted') {
    return NextResponse.json(
      { id: burnRequestId, status: finalRow.status, payoutStatus: finalRow.payoutStatus, error: finalRow.payoutError || 'Payment failed; burn reverted — balance restored.' },
      { status: 502 }
    )
  }
  if (finalRow?.payoutStatus === 'reconcile_required') {
    return NextResponse.json(
      {
        id: burnRequestId,
        status: finalRow.status,
        payoutStatus: finalRow.payoutStatus,
        error: finalRow.payoutError || 'Payment could not be confirmed',
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
      payoutStatus: finalRow?.payoutStatus ?? 'pending',
      reference: transId,
      kind,
      target: kind === 'lipa' ? { payNumber, network: network ?? null } : { utilityCode, utilityRef },
      recipientName: q.recipientName,
      principalTzs,
      burnAmountTzs,
      fees: { selcomFeeTzs, platformFeeTzs, totalFeeTzs: selcomFeeTzs + platformFeeTzs },
      message: `Payment of ${principalTzs} TZS dispatched${q.recipientName ? ` to ${q.recipientName}` : ''} (${selcomFeeTzs + platformFeeTzs} TZS in fees).`,
    },
    { status: 201 }
  )
}
