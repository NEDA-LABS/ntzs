import { eq } from 'drizzle-orm'
import { Contract, JsonRpcProvider, Wallet, parseUnits } from 'ethers'

import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY } from '@/lib/env'
import { burnRequests } from '@ntzs/db'
import { checkPayoutStatusFor } from '@/lib/psp'
import { getPayoutFeeTzs } from '@/lib/psp/selcom-fees'
import { BANK_FI_CODES, nedaAccountLookup, sendBankPayout } from '@/lib/psp/selcom'
import { resolveBankDestination } from '@/lib/waas/bank-destination'
import { resolveLpLedgerIdentity } from '@/lib/fx/lp-user'
import { db as fxDb } from '@/lib/fx/db'
import { lpAccounts, lpWalletTransactions } from '@ntzs/db'

const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
] as const

const MIN_CASHOUT_TZS = 5_000

export interface BankCashoutParams {
  amountTzs: number
  bankCode: string
  accountNumber: string
}

export interface BankCashoutResult {
  ok: boolean
  status?: number
  error?: string
  burnRequestId?: string
  burnTxHash?: string
  payoutReference?: string
  receiveAmountTzs?: number
  feeTzs?: number
  burnedTzs?: number
  recipientName?: string | null
}

/** Validate without side effects — shared by the queue path and execution. */
export function validateBankCashout(p: Partial<BankCashoutParams>): string | null {
  const amount = Number(p.amountTzs)
  if (!Number.isFinite(amount) || amount < MIN_CASHOUT_TZS) {
    return `Minimum cash-out is ${MIN_CASHOUT_TZS.toLocaleString()} TZS`
  }
  const bank = resolveBankDestination({ bankCode: p.bankCode, accountNumber: p.accountNumber })
  if (!bank) return 'bankCode and accountNumber are required'
  if ('error' in bank) return bank.error
  return null
}

/**
 * Redeem nTZS for TZS into the LP's bank account: burn, then pay out.
 *
 * This is the mirror of reserve funding — supply must fall by exactly what
 * leaves the reserve — so the burn is recorded in `burn_requests` and executed
 * on-chain, never a bare transfer. The payout rides Selcom (single-rail for
 * banks), and an initiation failure is NEVER auto-reverted: a failed HTTP
 * response is ambiguous until the PSP's own records say so, so the row is left
 * `reconcile_required` for an operator, exactly as the consumer path does.
 */
export async function executeBankCashout(
  lpId: string,
  params: BankCashoutParams,
): Promise<BankCashoutResult> {
  const validationError = validateBankCashout(params)
  if (validationError) return { ok: false, status: 400, error: validationError }

  const bank = resolveBankDestination(params) as { code: string; account: string }
  const receiveAmountTzs = Math.trunc(params.amountTzs)

  if (process.env.SELCOM_DISBURSEMENTS_ENABLED !== 'true') {
    return { ok: false, status: 503, error: 'Bank payouts are not enabled on this environment yet.' }
  }
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
  if (!contractAddress || !BASE_RPC_URL || !MINTER_PRIVATE_KEY) {
    return { ok: false, status: 503, error: 'Burn executor not configured' }
  }

  const identity = await resolveLpLedgerIdentity(lpId)
  if ('error' in identity) return { ok: false, status: identity.status, error: identity.error }
  const { lp, userId, walletId, mainDb } = identity

  // Selcom charges its payout fee on top of what the recipient receives, so the
  // LP burns the receive amount PLUS the fee — no invented platform margin.
  const feeTzs = getPayoutFeeTzs('selcom', receiveAmountTzs)
  const burnedTzs = receiveAmountTzs + feeTzs

  const provider = new JsonRpcProvider(BASE_RPC_URL)
  const token = new Contract(contractAddress, NTZS_BURN_ABI, new Wallet(MINTER_PRIVATE_KEY, provider))

  const balanceWei: bigint = await token.balanceOf(lp.walletAddress)
  const burnWei = parseUnits(String(burnedTzs), 18)
  if (balanceWei < burnWei) {
    if (lp.isActive) {
      return {
        ok: false,
        status: 400,
        error:
          'Your liquidity is in the pool while your account is active. Deactivate first to move funds back to your wallet, then cash out.',
      }
    }
    return {
      ok: false,
      status: 400,
      error: `Insufficient nTZS. Cashing out ${receiveAmountTzs.toLocaleString()} TZS burns ${burnedTzs.toLocaleString()} nTZS (incl. ${feeTzs.toLocaleString()} payout fee).`,
    }
  }

  // Registered-name lookup first: disclosure, and the transfer carries the
  // real name. Non-fatal, and skipped for lookup-disabled banks.
  let recipientName: string | null = null
  if (BANK_FI_CODES[bank.code]?.lookup) {
    const info = await nedaAccountLookup(bank.code, bank.account).catch(() => ({ name: null as string | null }))
    if (info.name) recipientName = info.name
  }

  const [burnRow] = await mainDb
    .insert(burnRequests)
    .values({
      userId,
      walletId,
      chain: 'base',
      contractAddress,
      amountTzs: burnedTzs,
      reason: 'SimpleFX bank cash-out',
      status: 'requested',
      requestedByUserId: userId,
      pspFeeTzs: feeTzs,
      spend: {
        kind: 'bank',
        bankCode: bank.code,
        accountNumber: bank.account,
        bankName: BANK_FI_CODES[bank.code]?.name ?? bank.code,
        recipientName,
        lpId,
      },
    })
    .returning({ id: burnRequests.id })

  if (!burnRow) return { ok: false, status: 500, error: 'Failed to record the burn' }
  const burnRequestId = burnRow.id

  let burnTxHash: string
  try {
    const tx = await token.burn(lp.walletAddress, burnWei)
    await tx.wait(1)
    burnTxHash = tx.hash
    await mainDb
      .update(burnRequests)
      .set({ status: 'burned', txHash: tx.hash, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await mainDb
      .update(burnRequests)
      .set({ status: 'failed', error: msg, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    return { ok: false, status: 502, error: `Burn failed: ${msg}` }
  }

  // Burn is on-chain and irreversible from here — a payout that cannot be
  // confirmed goes to reconcile_required, never an automatic re-mint.
  try {
    const dispatch = await sendBankPayout({
      amountTzs: receiveAmountTzs,
      bankName: bank.code,
      bankAccount: bank.account,
      recipientName: recipientName || 'nTZS Liquidity Provider',
      narration: 'SimpleFX cash-out',
      webhookUrl: `${process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''}/api/webhooks/selcom/payout`,
      metadata: { burn_request_id: burnRequestId, lp_id: lpId },
    })

    if (!dispatch.success || !dispatch.reference) {
      const reason = `${dispatch.error ?? 'Bank payout initiation failed'} (rail: selcom — banks are single-rail)`
      await mainDb
        .update(burnRequests)
        .set({ payoutStatus: 'reconcile_required', payoutError: reason, updatedAt: new Date() })
        .where(eq(burnRequests.id, burnRequestId))
      return {
        ok: false,
        status: 502,
        burnRequestId,
        burnTxHash,
        error: `Your nTZS was burned but the payout could not be dispatched (${reason}). This is under review — do not retry.`,
      }
    }

    await mainDb
      .update(burnRequests)
      .set({ payoutReference: dispatch.reference, payoutProvider: 'selcom', payoutStatus: 'pending', updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))

    await fxDb
      .insert(lpWalletTransactions)
      .values({
        lpId,
        chain: 'base',
        type: 'withdrawal',
        source: 'system',
        tokenAddress: contractAddress,
        tokenSymbol: 'nTZS',
        decimals: 18,
        amount: String(burnedTzs),
        txHash: burnTxHash,
      })
      .catch((e) => console.error('[fx/cashout] failed to record wallet tx:', e))

    // Bounded poll; the Selcom payout webhook finishes the slow tail.
    for (const delay of [2500, 4000]) {
      await new Promise((r) => setTimeout(r, delay))
      try {
        const ps = await checkPayoutStatusFor('selcom', dispatch.reference)
        if (ps.status === 'completed') {
          await mainDb
            .update(burnRequests)
            .set({ payoutStatus: 'completed', updatedAt: new Date() })
            .where(eq(burnRequests.id, burnRequestId))
          break
        }
        if (ps.status === 'failed' || ps.status === 'reversed') break
      } catch { /* keep polling */ }
    }

    return {
      ok: true,
      burnRequestId,
      burnTxHash,
      payoutReference: dispatch.reference,
      receiveAmountTzs,
      feeTzs,
      burnedTzs,
      recipientName,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await mainDb
      .update(burnRequests)
      .set({ payoutStatus: 'reconcile_required', payoutError: msg, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    return {
      ok: false,
      status: 502,
      burnRequestId,
      burnTxHash,
      error: `Your nTZS was burned but the payout could not be dispatched (${msg}). This is under review — do not retry.`,
    }
  }
}

/** Quote the burn for a given receive amount — same tariff the execution uses. */
export function quoteBankCashout(receiveAmountTzs: number): { feeTzs: number; burnedTzs: number } {
  const receive = Math.trunc(receiveAmountTzs)
  const feeTzs = getPayoutFeeTzs('selcom', receive)
  return { feeTzs, burnedTzs: receive + feeTzs }
}
