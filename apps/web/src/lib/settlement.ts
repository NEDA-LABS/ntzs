/**
 * Lender settlement cycle — the on-chain lender split + repayment pipeline.
 *
 * Ported from apps/worker/src/index.ts (Phases A, D, E) so it can run as a
 * Vercel Cron (/api/cron/settle) — the standalone worker is not deployed, so
 * collections were piling up `settlement_status = pending` and lenders were
 * never repaid. The merchant-payout phase (B) is intentionally excluded here
 * because it depends on the burn worker; running it without that would strand
 * merchant funds. See /api/cron/settle for scheduling.
 */
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { fundWalletWithGas } from '@/lib/waas/hd-wallets'
import { computeLoanPayoffTzs, MIN_LENDER_REPAYMENT_TZS } from './settlement-payoff'

type SqlClient = ReturnType<typeof getDb>['sql']

const MERCHANT_HD_MNEMONIC_KEY = 'MERCHANT_HD_MNEMONIC'
const MERCHANT_DERIVATION_BASE = "m/44'/8453'/2'/0"

const NTZS_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'] as const
const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

const WEI_PER_TZS = BigInt(10) ** BigInt(18)

function deriveMerchantWallet(walletIndex: number, provider: ethers.JsonRpcProvider) {
  const mnemonic = process.env[MERCHANT_HD_MNEMONIC_KEY] ?? process.env['FX_HD_MNEMONIC']
  if (!mnemonic) throw new Error('MERCHANT_HD_MNEMONIC env var not set')
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, MERCHANT_DERIVATION_BASE)
  return hdNode.deriveChild(walletIndex).connect(provider)
}

async function logAudit(sql: SqlClient, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
  await sql`
    insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
    values (${action}, ${entityType}, ${entityId}, ${JSON.stringify(metadata)}::jsonb, now())
  `
}

/**
 * Phase A — Queue the lender's split of each minted collection. Sales stay as
 * nTZS in the merchant's wallet (there is NO automatic per-sale conversion to
 * mobile money — cash-out is explicit, via withdrawals); the only per-sale
 * movement is the lender's cut accruing toward the next wallet→lender
 * transfer. The lender share is capped at the loan's remaining balance so they
 * can never collect past principal + interest; any excess simply stays in the
 * merchant's wallet.
 *
 * Keyed on the lender split itself — NOT on the merchant's settle_pct — so
 * lender repayment works regardless of settlement settings. (The old coupling
 * meant a merchant with settle_pct = 0 never repaid their lender.)
 */
async function queueCollectionSettlements(sql: SqlClient): Promise<number> {
  // Retire the legacy auto-settlement pot: collections created 'pending' by
  // older code no longer accrue anything; mark them skipped so nothing
  // downstream picks them up.
  await sql`
    update merchant_collections
    set settlement_status = 'skipped', updated_at = now()
    where settlement_status = 'pending'
  `

  const collections = await sql<{
    collection_id: string
    merchant_id: string
    lender_amount_tzs: number | null
  }[]>`
    select mc.id as collection_id, mc.merchant_id, mc.lender_amount_tzs
    from merchant_collections mc
    join merchant_accounts ma on ma.id = mc.merchant_id
    where mc.collection_status = 'minted'
      and mc.lender_settlement_status = 'pending'
      and mc.lender_pct > 0
      and ma.is_active = true
    order by mc.created_at asc
    limit 50
  `

  let processed = 0
  for (const col of collections) {
    if (!col.lender_amount_tzs || col.lender_amount_tzs <= 0) {
      await sql`
        update merchant_collections
        set lender_settlement_status = 'skipped', updated_at = now()
        where id = ${col.collection_id} and lender_settlement_status = 'pending'
      `
      continue
    }

    // Cap the lender's cut at what's still owed (minus what's already accrued).
    let lenderShareTzs = 0
    const [loan] = await sql<{ total_owed_tzs: number; repaid_tzs: number }[]>`
      select la.total_owed_tzs, la.repaid_tzs
      from enterprise_loan_agreements la
      join merchant_accounts ma on ma.id = ${col.merchant_id}
      where la.merchant_id = ${col.merchant_id}
        and la.partner_id = ma.lender_partner_id
        and la.status = 'active'
      limit 1
    `
    if (loan) {
      const [pend] = await sql<{ lender_pending_tzs: number }[]>`
        select lender_pending_tzs from merchant_accounts where id = ${col.merchant_id} limit 1
      `
      const remaining = Math.max(0, loan.total_owed_tzs - loan.repaid_tzs - (pend?.lender_pending_tzs ?? 0))
      lenderShareTzs = Math.min(col.lender_amount_tzs, remaining)
    }

    // Claim the collection before crediting so concurrent runs can't double-count.
    const claimed = await sql<{ id: string }[]>`
      update merchant_collections
      set lender_settlement_status = ${lenderShareTzs > 0 ? 'queued' : 'skipped'},
          lender_amount_tzs = ${lenderShareTzs},
          updated_at = now()
      where id = ${col.collection_id} and lender_settlement_status = 'pending'
      returning id
    `
    if (!claimed.length) continue

    if (lenderShareTzs > 0) {
      await sql`
        update merchant_accounts
        set lender_pending_tzs = lender_pending_tzs + ${lenderShareTzs}, updated_at = now()
        where id = ${col.merchant_id}
      `
    }
    processed += 1
  }
  return processed
}

/**
 * Phase D — Fire on-chain lender repayments. For each merchant whose
 * lender_pending_tzs crossed the minimum, transfer nTZS from the merchant's HD
 * wallet to the lender's treasury, record a transfer, and bump repaid_tzs.
 */
async function fireBatchLenderRepayments(sql: SqlClient): Promise<number> {
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  const rpcUrl = process.env.BASE_RPC_URL
  if (!contractAddress || !rpcUrl) return 0

  const merchants = await sql<{
    merchant_id: string
    wallet_address: string
    wallet_index: number
    lender_partner_id: string
    lender_pending_tzs: number
    lender_treasury_address: string
  }[]>`
    select ma.id as merchant_id, ma.wallet_address, ma.wallet_index, ma.lender_partner_id,
           ma.lender_pending_tzs, p.treasury_wallet_address as lender_treasury_address
    from merchant_accounts ma
    join partners p on p.id = ma.lender_partner_id
    where ma.lender_pending_tzs >= ${MIN_LENDER_REPAYMENT_TZS}
      and ma.lender_partner_id is not null
      and ma.is_active = true
    limit 5
  `

  let fired = 0
  for (const merchant of merchants) {
    const claimed = await sql<{ id: string }[]>`
      update merchant_accounts
      set lender_pending_tzs = 0, updated_at = now()
      where id = ${merchant.merchant_id} and lender_pending_tzs >= ${MIN_LENDER_REPAYMENT_TZS}
      returning id
    `
    if (!claimed.length) continue

    const amountTzs = merchant.lender_pending_tzs
    const amountWei = BigInt(String(amountTzs)) * BigInt(10) ** BigInt(18)

    let txHash: string | null = null
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const wallet = deriveMerchantWallet(merchant.wallet_index, provider)

      // The merchant wallet needs ETH to send the repayment transfer — top it up
      // from the relayer if low (the worker code never did this, which is part
      // of why repayments never fired).
      try {
        const gasBalance = await provider.getBalance(wallet.address)
        if (gasBalance < ethers.parseEther('0.00003')) {
          await fundWalletWithGas({ toAddress: wallet.address, rpcUrl, amountEth: '0.00005' })
        }
      } catch (gasErr) {
        console.warn('[settle] gas top-up failed (continuing):', gasErr instanceof Error ? gasErr.message : gasErr)
      }

      const iface = new ethers.Interface(NTZS_TRANSFER_ABI)
      const tx = await wallet.sendTransaction({
        to: contractAddress,
        data: iface.encodeFunctionData('transfer', [merchant.lender_treasury_address, amountWei]),
      })
      const receipt = await tx.wait()
      if (!receipt) throw new Error('No receipt for lender repayment transfer')
      txHash = receipt.hash
    } catch (err) {
      // Restore the pot so it retries next cycle
      await sql`
        update merchant_accounts
        set lender_pending_tzs = lender_pending_tzs + ${amountTzs}, updated_at = now()
        where id = ${merchant.merchant_id}
      `
      console.warn('[settle] lender repayment transfer failed', { merchantId: merchant.merchant_id, error: err instanceof Error ? err.message : String(err) })
      continue
    }

    const syntheticNeonId = `merchant_${merchant.wallet_address.toLowerCase()}`
    const userRows = await sql<{ id: string }[]>`select id from users where neon_auth_user_id = ${syntheticNeonId} limit 1`
    const userId = userRows[0]?.id
    if (userId) {
      await sql`
        insert into transfers (partner_id, from_user_id, to_address, token, amount_tzs, tx_hash, status, metadata, created_at, updated_at)
        values (
          ${merchant.lender_partner_id}, ${userId}, ${merchant.lender_treasury_address},
          'ntzs', ${amountTzs}, ${txHash}, 'completed',
          ${JSON.stringify({ reason: 'lender_repayment', merchantId: merchant.merchant_id, lenderPartnerId: merchant.lender_partner_id })}::jsonb,
          now(), now()
        )
      `
    }

    await sql`
      update merchant_collections
      set lender_settlement_status = 'completed', updated_at = now()
      where merchant_id = ${merchant.merchant_id} and lender_settlement_status = 'queued'
    `
    await sql`
      update enterprise_loan_agreements
      set repaid_tzs = repaid_tzs + ${amountTzs}, updated_at = now()
      where merchant_id = ${merchant.merchant_id} and partner_id = ${merchant.lender_partner_id} and status = 'active'
    `
    console.log('[settle] lender repayment fired', { merchantId: merchant.merchant_id, amountTzs, txHash })
    fired += 1
  }
  return fired
}

/**
 * Phase F — Balance-driven payoff. The drip (Phase A + D) only forwards the
 * lender's slice of each new sale, so a merchant can sit on far more nTZS than
 * they owe and still show an open loan. Here, for each merchant with an ACTIVE
 * loan whose on-chain nTZS balance already covers the full outstanding balance,
 * we repay the entire remaining loan in one transfer (never more than owed) and
 * let Phase E close it. This is what makes repayment automatic: the loan clears
 * the moment the wallet can afford it, instead of trickling out over months.
 */
async function fireBalancePayoffs(sql: SqlClient): Promise<number> {
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  const rpcUrl = process.env.BASE_RPC_URL
  if (!contractAddress || !rpcUrl) return 0

  const merchants = await sql<{
    merchant_id: string
    wallet_address: string
    wallet_index: number
    lender_partner_id: string
    lender_treasury_address: string
    loan_id: string
    total_owed_tzs: number
    repaid_tzs: number
  }[]>`
    select ma.id as merchant_id, ma.wallet_address, ma.wallet_index, ma.lender_partner_id,
           p.treasury_wallet_address as lender_treasury_address,
           la.id as loan_id, la.total_owed_tzs, la.repaid_tzs
    from merchant_accounts ma
    join partners p on p.id = ma.lender_partner_id
    join enterprise_loan_agreements la
      on la.merchant_id = ma.id and la.partner_id = ma.lender_partner_id and la.status = 'active'
    where ma.lender_partner_id is not null
      and ma.is_active = true
      and la.total_owed_tzs > la.repaid_tzs
    order by la.updated_at asc
    limit 5
  `

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const token = new ethers.Contract(contractAddress, NTZS_BALANCE_ABI, provider)

  let paid = 0
  for (const merchant of merchants) {
    let balanceTzs: number
    try {
      const raw: bigint = await token.balanceOf(merchant.wallet_address)
      balanceTzs = Number(raw / WEI_PER_TZS)
    } catch (balErr) {
      console.warn('[settle] payoff balance read failed (skip)', { merchantId: merchant.merchant_id, error: balErr instanceof Error ? balErr.message : balErr })
      continue
    }

    const amountTzs = computeLoanPayoffTzs({
      totalOwedTzs: merchant.total_owed_tzs,
      repaidTzs: merchant.repaid_tzs,
      balanceTzs,
    })
    if (amountTzs <= 0) continue

    // Claim: jump repaid_tzs to fully-repaid under an optimistic guard so no
    // concurrent run (or the drip phase) can double-pay the same loan.
    const claimed = await sql<{ id: string }[]>`
      update enterprise_loan_agreements
      set repaid_tzs = total_owed_tzs, updated_at = now()
      where id = ${merchant.loan_id} and status = 'active' and repaid_tzs = ${merchant.repaid_tzs}
      returning id
    `
    if (!claimed.length) continue

    const amountWei = BigInt(String(amountTzs)) * WEI_PER_TZS

    let txHash: string | null = null
    try {
      const wallet = deriveMerchantWallet(merchant.wallet_index, provider)

      // Merchant wallet needs ETH to send the transfer — top up from the relayer if low.
      try {
        const gasBalance = await provider.getBalance(wallet.address)
        if (gasBalance < ethers.parseEther('0.00003')) {
          await fundWalletWithGas({ toAddress: wallet.address, rpcUrl, amountEth: '0.00005' })
        }
      } catch (gasErr) {
        console.warn('[settle] payoff gas top-up failed (continuing):', gasErr instanceof Error ? gasErr.message : gasErr)
      }

      const iface = new ethers.Interface(NTZS_TRANSFER_ABI)
      const tx = await wallet.sendTransaction({
        to: contractAddress,
        data: iface.encodeFunctionData('transfer', [merchant.lender_treasury_address, amountWei]),
      })
      const receipt = await tx.wait()
      if (!receipt) throw new Error('No receipt for lender payoff transfer')
      txHash = receipt.hash
    } catch (err) {
      // Roll the claim back so it retries next cycle.
      await sql`
        update enterprise_loan_agreements
        set repaid_tzs = ${merchant.repaid_tzs}, updated_at = now()
        where id = ${merchant.loan_id}
      `
      console.warn('[settle] lender payoff transfer failed', { merchantId: merchant.merchant_id, error: err instanceof Error ? err.message : String(err) })
      continue
    }

    // The payoff supersedes the drip: clear the accrued pot and mark the queued
    // lender collections settled. Any still-`pending` collections self-heal — once
    // Phase E flips the loan to 'repaid', their lender share resolves to the merchant.
    await sql`
      update merchant_accounts
      set lender_pending_tzs = 0, updated_at = now()
      where id = ${merchant.merchant_id}
    `
    await sql`
      update merchant_collections
      set lender_settlement_status = 'completed', updated_at = now()
      where merchant_id = ${merchant.merchant_id} and lender_settlement_status = 'queued'
    `

    const syntheticNeonId = `merchant_${merchant.wallet_address.toLowerCase()}`
    const userRows = await sql<{ id: string }[]>`select id from users where neon_auth_user_id = ${syntheticNeonId} limit 1`
    const userId = userRows[0]?.id
    if (userId) {
      await sql`
        insert into transfers (partner_id, from_user_id, to_address, token, amount_tzs, tx_hash, status, metadata, created_at, updated_at)
        values (
          ${merchant.lender_partner_id}, ${userId}, ${merchant.lender_treasury_address},
          'ntzs', ${amountTzs}, ${txHash}, 'completed',
          ${JSON.stringify({ reason: 'lender_payoff', merchantId: merchant.merchant_id, lenderPartnerId: merchant.lender_partner_id, loanId: merchant.loan_id })}::jsonb,
          now(), now()
        )
      `
    }

    await logAudit(sql, 'lender_loan_paid_off', 'enterprise_loan_agreement', merchant.loan_id, {
      merchantId: merchant.merchant_id, lenderPartnerId: merchant.lender_partner_id, amountTzs, txHash,
    })
    console.log('[settle] lender loan paid off from balance', { merchantId: merchant.merchant_id, amountTzs, txHash })
    paid += 1
  }
  return paid
}

/**
 * Phase E — Auto-close fully-repaid loans and release the merchant's split.
 */
async function revertCompletedLoanAgreements(sql: SqlClient): Promise<number> {
  const completed = await sql<{ id: string; merchant_id: string; partner_id: string; principal_tzs: number; total_owed_tzs: number; repaid_tzs: number }[]>`
    select id, merchant_id, partner_id, principal_tzs, total_owed_tzs, repaid_tzs
    from enterprise_loan_agreements
    where status = 'active' and repaid_tzs >= total_owed_tzs and total_owed_tzs > 0
    limit 20
  `

  for (const a of completed) {
    await sql`update enterprise_loan_agreements set status = 'repaid', updated_at = now() where id = ${a.id}`
    await sql`
      update merchant_accounts
      set lender_split_pct = 0, lender_partner_id = null, lender_controls_settlement = false, withdrawal_limit_tzs = 0, updated_at = now()
      where id = ${a.merchant_id} and lender_partner_id = ${a.partner_id}
    `
    await logAudit(sql, 'loan_auto_reverted', 'enterprise_loan_agreement', a.id, {
      merchantId: a.merchant_id, lenderPartnerId: a.partner_id, principalTzs: a.principal_tzs, totalOwedTzs: a.total_owed_tzs, repaidTzs: a.repaid_tzs,
    })
  }
  return completed.length
}

export interface SettlementResult {
  queued: number
  paidOff: number
  repaymentsFired: number
  loansClosed: number
  errors: string[]
}

/**
 * Run one lender-settlement cycle: queue collections → pay off any loan the
 * merchant's balance can already cover → fire the remaining drip repayments →
 * close repaid loans. Each phase is isolated so one failing doesn't block the
 * others. Payoff runs before the drip so a covered loan settles in one transfer.
 */
export async function runLenderSettlement(sql: SqlClient): Promise<SettlementResult> {
  const result: SettlementResult = { queued: 0, paidOff: 0, repaymentsFired: 0, loansClosed: 0, errors: [] }

  try { result.queued = await queueCollectionSettlements(sql) }
  catch (err) { result.errors.push(`queue: ${err instanceof Error ? err.message : String(err)}`) }

  try { result.paidOff = await fireBalancePayoffs(sql) }
  catch (err) { result.errors.push(`payoff: ${err instanceof Error ? err.message : String(err)}`) }

  try { result.repaymentsFired = await fireBatchLenderRepayments(sql) }
  catch (err) { result.errors.push(`repay: ${err instanceof Error ? err.message : String(err)}`) }

  try { result.loansClosed = await revertCompletedLoanAgreements(sql) }
  catch (err) { result.errors.push(`close: ${err instanceof Error ? err.message : String(err)}`) }

  return result
}
