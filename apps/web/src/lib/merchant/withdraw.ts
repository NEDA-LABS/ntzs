import { eq } from 'drizzle-orm'
import { JsonRpcProvider, Contract } from 'ethers'

import { db } from '@/lib/merchant/db'
import { getDb } from '@/lib/db'
import { merchantAccounts } from '@ntzs/db'
import { isValidTanzanianPhone, normalizePhone, getPayoutRoute } from '@/lib/psp'
import { checkPerTransactionCap, checkUserPeriodLimits, limitErrorResponse } from '@/lib/sandbox/limits'
import { grossUpWithdrawal, MIN_WITHDRAWAL_TZS } from '@/lib/payouts/payout-math'

const SAFE_APPROVAL_THRESHOLD_TZS = 1000000
const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

export interface MerchantWithdrawResult {
  status: number
  body: Record<string, unknown>
}

/**
 * Explicit merchant cash-out of their OWN nTZS wallet balance: gross up so the
 * merchant receives exactly `receiveAmountTzs` on mobile money, verify the
 * wallet covers burn + fees, then queue an approved burn_request that the live
 * burn engine (/api/cron/process-burns) executes — burn from the merchant's
 * wallet, payout to their phone. Mirrors the consumer off-ramp
 * (/api/v1/withdrawals): same minimum, same fee formula, same BoT sandbox
 * caps, same >= 1M TZS admin-approval gate.
 *
 * Distinct from the financing withdraw (lender-treasury-funded facility draw)
 * and from the retired auto-settlement — this is on-demand, merchant-initiated.
 * Shared by the in-app merchant route (session auth) and the NEDApay
 * service-layer route (service-key auth).
 */
export async function requestMerchantWithdrawal(opts: {
  merchantId: string
  receiveAmountTzs: number
  phone?: string | null
}): Promise<MerchantWithdrawResult> {
  const { merchantId } = opts

  const [merchant] = await db
    .select({
      id: merchantAccounts.id,
      walletAddress: merchantAccounts.walletAddress,
      settlementPhone: merchantAccounts.settlementPhone,
      isActive: merchantAccounts.isActive,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant) return { status: 404, body: { error: 'Not found' } }
  if (!merchant.isActive) return { status: 403, body: { error: 'Account is not active' } }

  const receiveAmountTzs = Math.trunc(Number(opts.receiveAmountTzs))
  if (!Number.isFinite(receiveAmountTzs) || receiveAmountTzs < MIN_WITHDRAWAL_TZS) {
    return { status: 400, body: { error: `Minimum withdrawal is ${MIN_WITHDRAWAL_TZS.toLocaleString()} TZS (amount you receive)` } }
  }

  const phoneRaw = (opts.phone ?? '').trim() || merchant.settlementPhone || ''
  if (!phoneRaw || !isValidTanzanianPhone(phoneRaw)) {
    return { status: 400, body: { error: 'Valid Tanzanian phone number required (set one or pass phone)' } }
  }
  const phone = normalizePhone(phoneRaw)

  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  const rpcUrl = process.env.BASE_RPC_URL
  if (!contractAddress || !rpcUrl) return { status: 500, body: { error: 'Blockchain configuration missing' } }

  // Resolve the payout route once; the fee is baked into the gross-up and
  // stamped on the record so the executing burn engine pays the same route.
  const route = await getPayoutRoute('mobile', { receiveAmountTzs })
  const { burnAmountTzs, platformFeeTzs } = grossUpWithdrawal(receiveAmountTzs, undefined, route.pspFeeTzs)

  // BoT sandbox caps (applied to the nTZS burned, like the consumer off-ramp).
  const perTxnErr = checkPerTransactionCap(burnAmountTzs)
  if (perTxnErr) return { status: 400, body: limitErrorResponse(perTxnErr) }

  const { sql: rawSql } = getDb()

  // The merchant's synthetic user + base wallet (created on first payment).
  const syntheticNeonId = `merchant_${merchant.walletAddress.toLowerCase()}`
  const fkRows = await rawSql<{ user_id: string; wallet_id: string }[]>`
    select u.id as user_id, w.id as wallet_id
    from users u
    join wallets w on w.user_id = u.id and w.chain = 'base'
    where u.neon_auth_user_id = ${syntheticNeonId}
    limit 1
  `
  const userId = fkRows[0]?.user_id
  const walletId = fkRows[0]?.wallet_id
  if (!userId || !walletId) {
    return { status: 400, body: { error: 'Wallet not provisioned yet — collect a payment first' } }
  }

  const periodErr = await checkUserPeriodLimits(userId, burnAmountTzs)
  if (periodErr) return { status: 400, body: limitErrorResponse(periodErr) }

  // The wallet must cover the burn (net + fees).
  try {
    const provider = new JsonRpcProvider(rpcUrl)
    const token = new Contract(contractAddress, NTZS_BALANCE_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(merchant.walletAddress)
    const balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))
    if (balanceTzs < burnAmountTzs) {
      return {
        status: 400,
        body: {
          error: 'insufficient_balance',
          message: `Insufficient balance. Available: ${balanceTzs.toLocaleString()} TZS, need ${burnAmountTzs.toLocaleString()} TZS to pay out ${receiveAmountTzs.toLocaleString()} TZS (incl. fees).`,
          details: { available: balanceTzs, required: burnAmountTzs, receiveAmountTzs, platformFeeTzs, pspFeeTzs: route.pspFeeTzs },
        },
      }
    }
  } catch (err) {
    console.error('[merchant/withdraw] balance check failed:', err instanceof Error ? err.message : err)
    return { status: 500, body: { error: 'Failed to verify balance' } }
  }

  // >= 1M TZS requires admin approval (status 'requested'); otherwise queue as
  // 'approved' — the burn engine executes it within the next cron tick.
  const status = burnAmountTzs >= SAFE_APPROVAL_THRESHOLD_TZS ? 'requested' : 'approved'

  const burnRows = await rawSql<{ id: string }[]>`
    insert into burn_requests (
      user_id, wallet_id, chain, contract_address,
      amount_tzs, platform_fee_tzs, reason, status,
      requested_by_user_id, recipient_phone,
      payout_provider, psp_fee_tzs,
      created_at, updated_at
    ) values (
      ${userId}, ${walletId}, 'base', ${contractAddress},
      ${burnAmountTzs}, ${platformFeeTzs}, 'merchant_balance_withdrawal', ${status},
      ${userId}, ${phone},
      ${route.provider}, ${route.pspFeeTzs},
      now(), now()
    )
    returning id
  `
  const burnId = burnRows[0]?.id
  if (!burnId) return { status: 500, body: { error: 'Failed to create withdrawal request' } }

  await rawSql`
    insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
    values (
      'merchant_withdrawal_requested', 'burn_request', ${burnId},
      ${JSON.stringify({ merchantId: merchant.id, walletAddress: merchant.walletAddress, receiveAmountTzs, burnAmountTzs, platformFeeTzs, recipientPhone: phone, status })}::jsonb,
      now()
    )
  `

  return {
    status: 201,
    body: {
      ok: true,
      burnRequestId: burnId,
      status,
      receiveAmountTzs,
      burnAmountTzs,
      platformFeeTzs,
      pspFeeTzs: route.pspFeeTzs,
      phone,
      message: status === 'requested'
        ? 'Withdrawal requires admin approval for amounts >= 1,000,000 TZS.'
        : 'Withdrawal queued — cash typically arrives within a few minutes.',
    },
  }
}
