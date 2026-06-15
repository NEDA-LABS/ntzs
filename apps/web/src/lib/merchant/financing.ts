import { eq } from 'drizzle-orm'
import { JsonRpcProvider, Contract } from 'ethers'

import { db } from '@/lib/merchant/db'
import { getDb } from '@/lib/db'
import { merchantAccounts } from '@ntzs/db'
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp'

export interface FinancingWithdrawResult {
  status: number
  body: Record<string, unknown>
}

/**
 * Core merchant financing off-ramp: burn the lender's treasury nTZS and pay the
 * merchant mobile money, capped by the per-request limit and the revolving loan
 * facility. Shared by the in-app merchant route (session auth) and the NEDApay
 * service-layer route (service-key auth) so the money logic never diverges.
 */
export async function withdrawMerchantFinancing(opts: {
  merchantId: string
  amountTzs: number
  phone: string
}): Promise<FinancingWithdrawResult> {
  const { merchantId, amountTzs, phone } = opts

  const [merchant] = await db
    .select({
      id: merchantAccounts.id,
      walletAddress: merchantAccounts.walletAddress,
      walletIndex: merchantAccounts.walletIndex,
      lenderPartnerId: merchantAccounts.lenderPartnerId,
      withdrawalLimitTzs: merchantAccounts.withdrawalLimitTzs,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant) return { status: 404, body: { error: 'Not found' } }
  if (!merchant.lenderPartnerId) {
    return { status: 403, body: { error: 'Not under a lender financing programme' } }
  }
  if (merchant.withdrawalLimitTzs <= 0) {
    return { status: 403, body: { error: 'Withdrawals not enabled by your lender' } }
  }

  if (!amountTzs || amountTzs <= 0) {
    return { status: 400, body: { error: 'amountTzs must be positive' } }
  }
  if (amountTzs > merchant.withdrawalLimitTzs) {
    return { status: 400, body: { error: `Amount exceeds per-request cap of TZS ${merchant.withdrawalLimitTzs.toLocaleString()}` } }
  }
  if (!phone || !isValidTanzanianPhone(phone)) {
    return { status: 400, body: { error: 'Valid Tanzanian phone number required' } }
  }
  const normalizedPhone = normalizePhone(phone)

  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  if (!contractAddress) return { status: 500, body: { error: 'Contract address not configured' } }

  const { sql: rawSql } = getDb()

  // Reserve against the revolving loan facility (atomic; no overshoot of principal).
  const loanRows = await rawSql<{ id: string; principal_tzs: number; disbursed_tzs: number; repaid_tzs: number }[]>`
    select id, principal_tzs, disbursed_tzs, repaid_tzs
    from enterprise_loan_agreements
    where merchant_id = ${merchant.id} and partner_id = ${merchant.lenderPartnerId} and status = 'active'
    order by created_at asc
    limit 1
  `
  const loan = loanRows[0]
  let reservedLoanId: string | null = null

  if (loan) {
    const reserved = await rawSql<{ id: string }[]>`
      update enterprise_loan_agreements
      set disbursed_tzs = disbursed_tzs + ${amountTzs}, updated_at = now()
      where id = ${loan.id}
        and status = 'active'
        and (disbursed_tzs - repaid_tzs) + ${amountTzs} <= principal_tzs
      returning id
    `
    if (!reserved[0]) {
      const available = loan.principal_tzs - (loan.disbursed_tzs - loan.repaid_tzs)
      return { status: 400, body: { error: `Amount exceeds available financing. You can draw up to TZS ${Math.max(0, available).toLocaleString()}.`, availableTzs: Math.max(0, available) } }
    }
    reservedLoanId = loan.id
  }

  const releaseReservation = async () => {
    if (!reservedLoanId) return
    try {
      await rawSql`update enterprise_loan_agreements set disbursed_tzs = GREATEST(0, disbursed_tzs - ${amountTzs}), updated_at = now() where id = ${reservedLoanId}`
    } catch (err) {
      console.error('[financing/withdraw] CRITICAL: failed to release facility reservation', {
        loanId: reservedLoanId, merchantId: merchant.id, amountTzs, error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  try {
    // burn_requests.user_id/wallet_id are NOT NULL but here are record-keeping
    // FKs only — the real burn source is burn_from_address (the lender
    // treasury, set below). Resolve any valid user + base-wallet pair: prefer
    // the platform ops user, else fall back to the merchant's own synthetic
    // user (always present once they've collected a payment). The platform ops
    // user does not exist in all environments, so the fallback is what keeps
    // withdrawals working. Mirrors the lender disburse route.
    const platformEmail = process.env.PLATFORM_ADMIN_EMAIL || 'ops@nedapay.co.tz'
    const merchantSyntheticId = 'merchant_' + merchant.walletAddress.toLowerCase()
    const fkRows = await rawSql<{ user_id: string; wallet_id: string }[]>`
      select u.id as user_id, w.id as wallet_id
      from users u
      join wallets w on w.user_id = u.id and w.chain = 'base'
      where u.email = ${platformEmail} or u.neon_auth_user_id = ${merchantSyntheticId}
      order by case when u.email = ${platformEmail} then 0 else 1 end
      limit 1
    `
    const platformUserId = fkRows[0]?.user_id
    const platformWalletId = fkRows[0]?.wallet_id
    if (!platformUserId || !platformWalletId) { await releaseReservation(); return { status: 500, body: { error: 'No wallet available to record withdrawal' } } }

    // Disburse from the lender's treasury (their capital funds the off-ramp).
    const treasuryRows = await rawSql<{ treasury_wallet_address: string | null }[]>`
      select treasury_wallet_address from partners where id = ${merchant.lenderPartnerId} limit 1
    `
    const lenderTreasury = treasuryRows[0]?.treasury_wallet_address
    if (!lenderTreasury) { await releaseReservation(); return { status: 503, body: { error: 'Lender treasury not provisioned' } } }

    const rpcUrl = process.env.BASE_RPC_URL
    if (rpcUrl) {
      try {
        const provider = new JsonRpcProvider(rpcUrl)
        const token = new Contract(contractAddress, ['function balanceOf(address) view returns (uint256)'], provider)
        const balance: bigint = await token.balanceOf(lenderTreasury)
        const needed = BigInt(amountTzs) * (BigInt(10) ** BigInt(18))
        if (balance < needed) {
          await releaseReservation()
          const haveTzs = Number(balance / (BigInt(10) ** BigInt(18)))
          return { status: 400, body: { error: `Lender treasury has insufficient funds (TZS ${haveTzs.toLocaleString()} available). Ask your lender to top up their treasury.`, availableTzs: haveTzs } }
        }
      } catch (err) {
        console.error('[financing/withdraw] treasury balance check failed (continuing):', err instanceof Error ? err.message : err)
      }
    }

    const burnRows = await rawSql<{ id: string }[]>`
      insert into burn_requests (
        user_id, wallet_id, chain, contract_address,
        amount_tzs, reason, status,
        requested_by_user_id, recipient_phone, burn_from_address,
        created_at, updated_at
      ) values (
        ${platformUserId}, ${platformWalletId}, 'base', ${contractAddress},
        ${amountTzs}, 'merchant_withdrawal', 'approved',
        ${platformUserId}, ${normalizedPhone}, ${lenderTreasury},
        now(), now()
      )
      returning id
    `
    const burnId = burnRows[0]?.id
    if (!burnId) { await releaseReservation(); return { status: 500, body: { error: 'Failed to create withdrawal request' } } }

    await rawSql`
      insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
      values (
        'merchant_withdrawal_requested', 'burn_request', ${burnId},
        ${JSON.stringify({ merchantId: merchant.id, walletAddress: merchant.walletAddress, walletIndex: merchant.walletIndex, loanId: reservedLoanId, amountTzs, recipientPhone: normalizedPhone })}::jsonb,
        now()
      )
    `

    return { status: 201, body: { ok: true, burnRequestId: burnId, amountTzs, phone: normalizedPhone } }
  } catch (err) {
    await releaseReservation()
    console.error('[financing/withdraw] failed', err instanceof Error ? err.message : err)
    return { status: 500, body: { error: 'Failed to create withdrawal request' } }
  }
}
