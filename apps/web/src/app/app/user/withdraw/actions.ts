'use server'

import { and, eq, gte, isNull, ne, or, sql } from 'drizzle-orm'
import { ethers } from 'ethers'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { enforceSandboxLimits } from '@/lib/sandbox/limits'
import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, PLATFORM_TREASURY_ADDRESS } from '@/lib/env'
import { burnRequests, kycCases, wallets } from '@ntzs/db'
import { isValidTanzanianPhone, normalizePhone, sendPayoutRouted, checkPayoutStatusFor, expectedPayoutFeeTzs } from '@/lib/psp'
import { payoutRailsLookDead, CIRCUIT_OPEN_RESPONSE } from '@/lib/psp/payout-circuit'
import { getPayoutFeeTzs } from '@/lib/psp/selcom-fees'
import { BANK_FI_CODES, nedaAccountLookup, sendBankPayout as selcomSendBankPayout } from '@/lib/psp/selcom'
import { resolveBankDestination } from '@/lib/waas/bank-destination'
import { writeAuditLog } from '@/lib/audit'
import { SAFE_BURN_THRESHOLD_TZS } from '@/lib/approvals/thresholds'

const PLATFORM_FEE_PERCENT = 0.5
const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''

const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function paused() view returns (bool)',
] as const

export type WithdrawActionResult =
  | { success: true; requiresApproval: boolean }
  | { success: false; error: string }

export async function createWithdrawRequestAction(formData: FormData): Promise<WithdrawActionResult> {
  try {
    return await _createWithdrawRequestAction(formData)
  } catch (err) {
    // Next.js redirect() and notFound() throw special errors — let them propagate
    if (err instanceof Error && 'digest' in err && typeof (err as { digest?: string }).digest === 'string') {
      throw err
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[withdraw] unhandled error in createWithdrawRequestAction', msg)
    return { success: false, error: `Withdrawal failed: ${msg}` }
  }
}

async function _createWithdrawRequestAction(formData: FormData): Promise<WithdrawActionResult> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const amountTzsRaw = String(formData.get('amountTzs') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()

  // amountTzsRaw is the amount the user wants to RECEIVE
  const receiveAmountTzs = Number(amountTzsRaw)
  if (!Number.isFinite(receiveAmountTzs) || receiveAmountTzs < 5000) {
    return { success: false, error: 'Minimum receive amount is 5,000 TZS' }
  }

  // Destination: a mobile wallet (phone) OR a bank account (bankCode +
  // accountNumber) — never both. Same resolver the partner API uses, so the
  // two surfaces can never disagree on what a valid destination is.
  const bankParsed = resolveBankDestination({
    bankCode: String(formData.get('bankCode') ?? '').trim() || undefined,
    accountNumber: String(formData.get('accountNumber') ?? '').trim() || undefined,
  })
  if (bankParsed && 'error' in bankParsed) {
    return { success: false, error: bankParsed.error }
  }
  const bank = bankParsed

  if (phone && bank) {
    return { success: false, error: 'Choose one destination: mobile money or bank account' }
  }
  if (!phone && !bank) {
    return { success: false, error: 'A destination is required: mobile number or bank account' }
  }
  if (phone && !isValidTanzanianPhone(phone)) {
    return { success: false, error: 'Invalid Tanzanian mobile number' }
  }
  if (bank && process.env.SELCOM_DISBURSEMENTS_ENABLED !== 'true') {
    return { success: false, error: 'Bank payouts are not enabled on this environment yet.' }
  }

  const { db } = getDb()

  const allWallets = await db.query.wallets.findMany({
    where: and(
      eq(wallets.userId, dbUser.id),
      eq(wallets.chain, 'base'),
      eq(wallets.frozen, false),
    ),
  })
  if (!allWallets.length) redirect('/app/user/wallet')

  // Default selection: prefer platform_hd (most recently provisioned active wallet).
  // Will be overridden below if a different wallet holds the actual balance.
  let wallet = allWallets.find(w => w.provider === 'platform_hd') ?? allWallets[0]!

  const approvedKyc = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .where(and(eq(kycCases.userId, dbUser.id), eq(kycCases.status, 'approved')))
    .limit(1)
  if (!approvedKyc.length) redirect('/app/user/kyc')

  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
  if (!contractAddress) return { success: false, error: 'Contract not configured' }

  const recipientPhone = bank ? null : normalizePhone(phone)

  // Gross-up: user specifies receive amount, we calculate how much nTZS to burn
  // burnAmount = ceil((receiveAmount + pspFee) / (1 - platformFeeRate)).
  // The PSP fee is the EXPECTED SERVING RAIL's charge (Selcom is tiered — 150
  // at 5,000 TZS — not Snippe's flat 1,500); the same function prices the
  // form, this action, and the WaaS quote endpoint.
  const receiveAmountTrunc = Math.trunc(receiveAmountTzs)
  // Banks are single-rail (Selcom) and tiered differently from the mobile
  // rails, so price the leg that will actually serve this destination.
  const pspFeeTzs = bank
    ? getPayoutFeeTzs('selcom', receiveAmountTrunc)
    : expectedPayoutFeeTzs(receiveAmountTrunc)
  const amountTzsTrunc = Math.ceil((receiveAmountTrunc + pspFeeTzs) / (1 - PLATFORM_FEE_PERCENT / 100))
  const platformFeeTzs = amountTzsTrunc - receiveAmountTrunc - pspFeeTzs

  // BoT Parameters #3/#4/#5, measured on the GROSS burn — the nTZS actually
  // leaving the participant's wallet, which is what the return reports and
  // what the cap is about. Checked before anything is written or burned, so a
  // refusal costs the user nothing and leaves the evidence that it bound.
  const limitErr = await enforceSandboxLimits(
    { kind: 'user', id: dbUser.id },
    amountTzsTrunc,
    { endpoint: 'app/user/withdraw', stage: 'execute' },
  )
  if (limitErr) return { success: false, error: limitErr.message }
  // The rail's `amount` = net amount the recipient receives; the PSP debits its
  // own charge separately on top of this from our PSP balance/float. So we pass
  // the exact receive amount.
  const payoutAmountTzs = receiveAmountTrunc

  // Large amounts require admin approval — queue and exit
  if (amountTzsTrunc >= SAFE_BURN_THRESHOLD_TZS) {
    const [queuedBurn] = await db.insert(burnRequests).values({
      userId: dbUser.id,
      walletId: wallet.id,
      chain: wallet.chain,
      contractAddress,
      amountTzs: amountTzsTrunc,
      reason: 'User withdrawal',
      status: 'requires_second_approval',
      requestedByUserId: dbUser.id,
      recipientPhone,
      platformFeeTzs,
      pspFeeTzs,
      // Bank destinations have no phone — the descriptor IS the destination
      // record, and the approver's dispatch reads it back from here.
      ...(bank
        ? { spend: { kind: 'bank' as const, bankCode: bank.code, accountNumber: bank.account, bankName: BANK_FI_CODES[bank.code].name } }
        : {}),
    }).returning({ id: burnRequests.id })
    await writeAuditLog('burn.queued_for_approval', 'burn_request', queuedBurn.id, { amountTzs: amountTzsTrunc, receiveAmountTzs: receiveAmountTrunc, platformFeeTzs, pspFeeTzs }, dbUser.id)
    return { success: true as const, requiresApproval: true }
  }


  // ── Small amounts: execute burn + payout inline ──────────────────────────

  const rpcUrl = BASE_RPC_URL
  const privateKey = MINTER_PRIVATE_KEY
  if (!rpcUrl || !privateKey) return { success: false, error: 'Burn executor not configured' }

  // Pre-flight on-chain balance check — avoids cryptic revert messages.
  // Iterates ALL user wallets so that a CDP/HD provider mismatch (tokens minted
  // to the CDP address before migration) is handled transparently: we burn from
  // whichever address actually holds the balance.
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(contractAddress, NTZS_BURN_ABI, provider)

    let fundedWallet: (typeof allWallets)[0] | null = null
    let maxBalanceTzs = BigInt(0)

    for (const w of allWallets) {
      const balWei: bigint = await token.balanceOf(w.address)
      const balTzs = balWei / (BigInt(10) ** BigInt(18))
      if (balTzs >= BigInt(amountTzsTrunc)) {
        fundedWallet = w
        break
      }
      if (balTzs > maxBalanceTzs) maxBalanceTzs = balTzs
    }

    if (!fundedWallet) {
      return {
        success: false,
        error: `Insufficient balance. You have ${maxBalanceTzs.toString()} nTZS but need ${amountTzsTrunc.toLocaleString()} nTZS to withdraw ${receiveAmountTrunc.toLocaleString()} TZS (including fees).`,
      }
    }

    wallet = fundedWallet
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Could not verify balance: ${msg}` }
  }

  // Duplicate guard — same user, same destination, same amount within 5
  // minutes while an earlier attempt still holds funds. On 1 Aug 2026 retries
  // against dead rails burned repeatedly for one intended cash-out. Bank
  // destinations carry no phone, so they match on the account in `spend`.
  {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    const sameDestination = bank
      ? sql`${burnRequests.spend}->>'accountNumber' = ${bank.account} and ${burnRequests.spend}->>'bankCode' = ${bank.code}`
      : eq(burnRequests.recipientPhone, recipientPhone!)
    const [dup] = await db
      .select({ id: burnRequests.id, payoutStatus: burnRequests.payoutStatus })
      .from(burnRequests)
      .where(and(
        eq(burnRequests.userId, dbUser.id),
        sameDestination,
        eq(burnRequests.amountTzs, amountTzsTrunc),
        gte(burnRequests.createdAt, fiveMinAgo),
        ne(burnRequests.status, 'failed'),
        or(isNull(burnRequests.payoutStatus), ne(burnRequests.payoutStatus, 'reverted')),
      ))
      .limit(1)
    if (dup) {
      return {
        success: false,
        error: 'An identical withdrawal was made moments ago and is still processing. Do not retry — check its status; if it fails, your balance is restored automatically.',
      }
    }
  }

  // Circuit breaker — when the rails are evidently refusing initiations,
  // refuse BEFORE the burn (balance untouched) instead of burning into a
  // stranded reconcile row.
  const circuit = await payoutRailsLookDead()
  if (circuit.dead) {
    console.warn('[withdraw] circuit open — refusing pre-burn:', circuit.reason)
    return { success: false, error: CIRCUIT_OPEN_RESPONSE.message }
  }

  // Create burn request record first (so we have an ID for the audit trail)
  const [burnReq] = await db
    .insert(burnRequests)
    .values({
      userId: dbUser.id,
      walletId: wallet.id,
      chain: wallet.chain,
      contractAddress,
      amountTzs: amountTzsTrunc,
      reason: 'User withdrawal',
      status: 'burn_submitted',
      requestedByUserId: dbUser.id,
      recipientPhone,
      platformFeeTzs,
      pspFeeTzs,
    })
    .returning({ id: burnRequests.id })

  const burnRequestId = burnReq.id

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const signer = new ethers.Wallet(privateKey, provider)
    const token = new ethers.Contract(contractAddress, NTZS_BURN_ABI, signer)

    const paused: boolean = await token.paused()
    if (paused) throw new Error('Token is paused — withdrawals temporarily disabled')

    const burnerRole: string = await token.BURNER_ROLE()
    const hasBurner: boolean = await token.hasRole(burnerRole, await signer.getAddress())
    if (!hasBurner) throw new Error('Burn key lacks BURNER_ROLE — contact support')

    const amountWei = BigInt(amountTzsTrunc) * BigInt(10) ** BigInt(18)
    const tx = await token.burn(wallet.address, amountWei)

    await db
      .update(burnRequests)
      .set({ txHash: tx.hash, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))

    await tx.wait(1)

    await db
      .update(burnRequests)
      .set({ status: 'burned', updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))

    // ── Mint platform fee to treasury (best-effort, non-fatal) ────────────
    // Preserves 1:1 backing: net supply change = -(burn - feeMint) = -payoutAmount
    // NOTE: we submit the TX but do NOT await feeTx.wait(1) — waiting for
    // on-chain confirmation inside a Vercel serverless function risks a timeout
    // (Base blocks every ~2 s but slot inclusion can take 5–15 s under load).
    // The TX hash is recorded immediately; on-chain finality is eventual.
    if (platformFeeTzs > 0 && ethers.isAddress(PLATFORM_TREASURY_ADDRESS)) {
      try {
        const feeAmountWei = BigInt(platformFeeTzs) * BigInt(10) ** BigInt(18)
        const feeTx = await token.mint(PLATFORM_TREASURY_ADDRESS, feeAmountWei)
        await db
          .update(burnRequests)
          .set({
            feeTxHash: feeTx.hash,
            feeRecipientAddress: PLATFORM_TREASURY_ADDRESS,
            updatedAt: new Date(),
          })
          .where(eq(burnRequests.id, burnRequestId))
      } catch (feeErr) {
        // Fee-mint failure must not block the withdrawal — log and continue
        const feeErrMsg = feeErr instanceof Error ? feeErr.message : String(feeErr)
        console.error('[withdraw] fee mint failed (non-fatal)', { burnRequestId, error: feeErrMsg })
        await writeAuditLog('burn.fee_mint_failed', 'burn_request', burnRequestId, { platformFeeTzs, treasury: PLATFORM_TREASURY_ADDRESS, error: feeErrMsg }, dbUser.id)
      }
    } else if (platformFeeTzs > 0) {
      console.warn('[withdraw] PLATFORM_TREASURY_ADDRESS not configured — platform fee kept as implicit reserve surplus', { burnRequestId, platformFeeTzs })
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db
      .update(burnRequests)
      .set({ status: 'failed', error: errorMessage, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    console.error('[withdraw] burn failed', { burnRequestId, error: errorMessage })
    return { success: false, error: `Burn failed: ${errorMessage}` }
  }

  // ── Burn confirmed — bank leg (single-rail Selcom) ───────────────────────
  // Banks ride Selcom only: no failover, so an initiation failure lands in
  // reconcile_required rather than auto-reverting (same doctrine as wallets —
  // a failed HTTP response is ambiguous until the PSP's records say so).
  if (bank) {
    let verifiedRecipientName: string | null = null
    if (BANK_FI_CODES[bank.code].lookup) {
      const info = await nedaAccountLookup(bank.code, bank.account).catch(() => ({ name: null as string | null }))
      if (info.name) verifiedRecipientName = info.name
    }

    const bankSpend = {
      kind: 'bank' as const,
      bankCode: bank.code,
      accountNumber: bank.account,
      bankName: BANK_FI_CODES[bank.code].name,
      recipientName: verifiedRecipientName,
    }

    try {
      const dispatchResult = await selcomSendBankPayout({
        amountTzs: payoutAmountTzs,
        bankName: bank.code,
        bankAccount: bank.account,
        recipientName: verifiedRecipientName || 'nTZS User',
        narration: 'nTZS withdrawal',
        webhookUrl: `${APP_URL}/api/webhooks/selcom/payout`,
        metadata: { burn_request_id: burnRequestId },
      })

      if (dispatchResult.success && dispatchResult.reference) {
        await db
          .update(burnRequests)
          .set({
            payoutReference: dispatchResult.reference,
            payoutProvider: 'selcom',
            payoutStatus: 'pending',
            spend: bankSpend,
            updatedAt: new Date(),
          })
          .where(eq(burnRequests.id, burnRequestId))
        await writeAuditLog('burn.payout_initiated', 'burn_request', burnRequestId, { amountTzs: amountTzsTrunc, receiveAmountTzs: receiveAmountTrunc, platformFeeTzs, pspFeeTzs, payoutReference: dispatchResult.reference, bankCode: bank.code, rail: 'selcom' }, dbUser.id)

        // Bounded poll — the Selcom payout webhook finishes the slow tail.
        for (const delay of [2500, 4000]) {
          await new Promise((r) => setTimeout(r, delay))
          try {
            const ps = await checkPayoutStatusFor('selcom', dispatchResult.reference)
            if (ps.status === 'completed') {
              await db
                .update(burnRequests)
                .set({ payoutStatus: 'completed', status: 'burned', updatedAt: new Date() })
                .where(eq(burnRequests.id, burnRequestId))
              break
            }
            if (ps.status === 'failed' || ps.status === 'reversed') break
          } catch { /* keep polling */ }
        }
        return { success: true as const, requiresApproval: false }
      }

      const reason = `${dispatchResult.error ?? 'Bank payout initiation failed'} (rail: selcom — banks are single-rail)`
      console.error('[withdraw] bank payout initiation failed (NOT auto-reverting)', { burnRequestId, error: reason })
      await db
        .update(burnRequests)
        .set({ payoutReference: dispatchResult.reference ?? null, payoutStatus: 'reconcile_required', payoutError: reason, spend: bankSpend, updatedAt: new Date() })
        .where(eq(burnRequests.id, burnRequestId))
      await writeAuditLog('burn.payout_initiation_failed_reconcile_required', 'burn_request', burnRequestId, { amountTzs: amountTzsTrunc, receiveAmountTzs: receiveAmountTrunc, platformFeeTzs, payoutError: reason, bankCode: bank.code, note: 'Burn already executed on-chain. Operator must verify with Selcom before reverting.' }, dbUser.id)
      return {
        success: false,
        error: `Your payout could not be dispatched (${reason}). Your withdrawal is under review — do not retry. We will confirm and either complete the payout or restore your nTZS balance within a few hours.`,
      }
    } catch (payoutErr) {
      const msg = payoutErr instanceof Error ? payoutErr.message : String(payoutErr)
      console.error('[withdraw] bank payout error (NOT auto-reverting)', { burnRequestId, error: msg })
      await db
        .update(burnRequests)
        .set({ payoutStatus: 'reconcile_required', payoutError: msg, spend: bankSpend, updatedAt: new Date() })
        .where(eq(burnRequests.id, burnRequestId))
      await writeAuditLog('burn.payout_initiation_failed_reconcile_required', 'burn_request', burnRequestId, { amountTzs: amountTzsTrunc, payoutError: msg, bankCode: bank.code, note: 'Burn already executed on-chain. Operator must verify with Selcom before reverting.' }, dbUser.id)
      return {
        success: false,
        error: `Your payout could not be dispatched (${msg}). Your withdrawal is under review — do not retry. We will confirm and either complete the payout or restore your nTZS balance within a few hours.`,
      }
    }
  }

  // ── Burn confirmed — now trigger the payout with RAIL FAILOVER ───────────
  // Single-rail dispatch died platform-wide on 1 Aug 2026 when Snippe flagged
  // our account; the routed dispatcher walks DISBURSEMENT_RAIL_PRIORITY and
  // sends each rail its own webhook URL.
  const routed = await sendPayoutRouted({
    amountTzs: payoutAmountTzs,
    // Non-null: the bank branch above returns, so this is the wallet path.
    recipientPhone: recipientPhone!,
    recipientName: 'nTZS User',
    narration: 'nTZS withdrawal',
    webhookBaseUrl: APP_URL,
    metadata: { burn_request_id: burnRequestId },
  })
  const payoutResult = routed.payout

  if (payoutResult.success && payoutResult.reference) {
    await db
      .update(burnRequests)
      .set({ payoutReference: payoutResult.reference, payoutProvider: routed.provider, payoutStatus: 'pending', updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    await writeAuditLog('burn.payout_initiated', 'burn_request', burnRequestId, { amountTzs: amountTzsTrunc, receiveAmountTzs: receiveAmountTrunc, platformFeeTzs, pspFeeTzs, payoutReference: payoutResult.reference, recipientPhone, rail: routed.provider }, dbUser.id)
    return { success: true as const, requiresApproval: false }
  }

  // ── Payout initiation failed ─────────────────────────────────────────────
  // We do NOT auto-revert the burn here. A failed HTTP response from Snippe
  // is ambiguous: the request may have been rejected cleanly (safe to
  // revert), or it may have been partially processed/queued on their side
  // (revert would double-pay the user once Snippe's retry lands). Only a
  // signed `payout.failed` webhook or an explicit `GET /v1/payouts/{ref}`
  // returning `failed`/`reversed` is authoritative enough to auto-revert.
  //
  // Mark the burn as `reconcile_required` and surface a clear message to
  // the user. An operator must confirm via Snippe dashboard that no payout
  // was dispatched before the revert is triggered (see the admin reconcile
  // endpoint — /api/admin/burns/:id/reconcile).
  const payoutErr = `${payoutResult.error ?? 'Payout initiation failed'} (rails tried: ${routed.attempted.join(' → ') || 'none'})`
  console.error('[withdraw] payout failed (NOT auto-reverting — awaiting PSP confirmation)', {
    burnRequestId,
    error: payoutErr,
  })

  await db
    .update(burnRequests)
    .set({
      // Persist Snippe's reference even on failure — without this we lose
      // the only API handle to reconcile the payout later.
      payoutReference: payoutResult.reference ?? null,
      payoutStatus: 'reconcile_required',
      payoutError: payoutErr,
      updatedAt: new Date(),
    })
    .where(eq(burnRequests.id, burnRequestId))

  await writeAuditLog(
    'burn.payout_initiation_failed_reconcile_required',
    'burn_request',
    burnRequestId,
    {
      amountTzs: amountTzsTrunc,
      receiveAmountTzs: receiveAmountTrunc,
      platformFeeTzs,
      payoutError: payoutErr,
      recipientPhone,
      note: 'Burn already executed on-chain. Operator must verify with Snippe dashboard whether any payout was dispatched before deciding to remint or mark completed.',
    },
    dbUser.id,
  )

  return {
    success: false,
    error: `Your payout could not be dispatched (${payoutErr}). Your withdrawal is under review — do not retry. We will confirm and either complete the payout or restore your nTZS balance within a few hours.`,
  }
}
