/**
 * Lender settlement cycle — the on-chain lender split + repayment pipeline.
 *
 * Ported from apps/worker/src/index.ts (Phases A, D, E) so it can run as a
 * Vercel Cron (/api/cron/settle) — the standalone worker's settlement phases
 * are not deployed, so collections were piling up `settlement_status = pending`
 * and lenders were never repaid.
 *
 * Lender pipeline (Phases A/D/E) runs fully here, including the on-chain
 * merchant-wallet→treasury repayment. The merchant payout (Phases B/C) only
 * QUEUES an approved burn_request and syncs its status; the actual on-chain
 * burn + Snippe fiat payout is left to the standalone burn worker (still live —
 * it processes WaaS/user off-ramps), so no irreversible on-chain off-ramp runs
 * in this serverless context. See /api/cron/settle for scheduling.
 */
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { fundWalletWithGas } from '@/lib/waas/hd-wallets'

type SqlClient = ReturnType<typeof getDb>['sql']

const MIN_LENDER_REPAYMENT_TZS = 1000

// Merchant-settlement payout (Phase B/C) — mirrors apps/worker constants.
const MIN_SETTLEMENT_TZS = 5000
const SNIPPE_FLAT_FEE_TZS = 1500
const PLATFORM_FEE_PCT = 0.005

const MERCHANT_HD_MNEMONIC_KEY = 'MERCHANT_HD_MNEMONIC'
const MERCHANT_DERIVATION_BASE = "m/44'/8453'/2'/0"

const NTZS_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'] as const

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
 * Phase A — Queue collections. For each minted, pending collection add the
 * merchant's share to settlement_pending_tzs and the lender's (capped) share to
 * lender_pending_tzs. The lender share is capped at the loan's remaining balance
 * so they can never collect past principal + interest; the excess returns to the
 * merchant.
 */
async function queueCollectionSettlements(sql: SqlClient): Promise<number> {
  const collections = await sql<{
    collection_id: string
    merchant_id: string
    amount_tzs: number
    settle_pct: number
    lender_pct: number
    lender_amount_tzs: number | null
    lender_settlement_status: string
  }[]>`
    select mc.id as collection_id, mc.merchant_id, mc.amount_tzs, mc.settle_pct,
           mc.lender_pct, mc.lender_amount_tzs, mc.lender_settlement_status
    from merchant_collections mc
    join merchant_accounts ma on ma.id = mc.merchant_id
    where mc.collection_status = 'minted'
      and mc.settlement_status = 'pending'
      and mc.settle_pct > 0
      and ma.settlement_phone is not null
      and ma.is_active = true
    order by mc.created_at asc
    limit 50
  `

  let processed = 0
  for (const col of collections) {
    const claimed = await sql<{ id: string }[]>`
      update merchant_collections
      set settlement_status = 'queued', updated_at = now()
      where id = ${col.collection_id} and settlement_status = 'pending'
      returning id
    `
    if (!claimed.length) continue

    let merchantShareTzs = Math.floor((col.amount_tzs * col.settle_pct) / 100)
    let lenderShareTzs = 0
    const wantsLenderSplit = col.lender_pct > 0 && !!col.lender_amount_tzs && col.lender_settlement_status === 'pending'

    if (wantsLenderSplit) {
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
        lenderShareTzs = Math.min(col.lender_amount_tzs!, remaining)
      }
      merchantShareTzs += col.lender_amount_tzs! - lenderShareTzs
    }

    await sql`
      update merchant_accounts
      set settlement_pending_tzs = settlement_pending_tzs + ${merchantShareTzs}, updated_at = now()
      where id = ${col.merchant_id}
    `
    await sql`
      update merchant_collections
      set settlement_amount_tzs = ${merchantShareTzs}, updated_at = now()
      where id = ${col.collection_id}
    `

    if (wantsLenderSplit) {
      if (lenderShareTzs > 0) {
        await sql`
          update merchant_accounts
          set lender_pending_tzs = lender_pending_tzs + ${lenderShareTzs}, updated_at = now()
          where id = ${col.merchant_id}
        `
      }
      await sql`
        update merchant_collections
        set lender_settlement_status = ${lenderShareTzs > 0 ? 'queued' : 'skipped'},
            lender_amount_tzs = ${lenderShareTzs},
            updated_at = now()
        where id = ${col.collection_id} and lender_settlement_status = 'pending'
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

/**
 * Phase B — Fire merchant payouts. For each merchant whose accumulated
 * settlement_pending_tzs crossed the PSP minimum, atomically claim the full pot
 * and insert ONE approved burn_request. The standalone burn worker (still live —
 * it processes WaaS/user off-ramp burns) picks it up, burns nTZS from the
 * merchant wallet on-chain and pays out fiat via Snippe. We deliberately do NOT
 * burn here: keep the irreversible on-chain off-ramp in the proven worker, and
 * keep this serverless cron to safe, idempotent DB writes only.
 */
async function fireBatchMerchantSettlements(sql: SqlClient): Promise<number> {
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  if (!contractAddress) return 0

  const merchants = await sql<{
    merchant_id: string
    wallet_address: string
    settlement_phone: string
    settlement_pending_tzs: number
  }[]>`
    select id as merchant_id, wallet_address, settlement_phone, settlement_pending_tzs
    from merchant_accounts
    where settlement_pending_tzs >= ${MIN_SETTLEMENT_TZS}
      and settlement_phone is not null
      and is_active = true
    limit 5
  `

  let fired = 0
  for (const merchant of merchants) {
    // Atomically claim the full pot — prevents a double-fire if the worker's own
    // Phase B ever wakes up alongside this cron.
    const claimed = await sql<{ id: string }[]>`
      update merchant_accounts
      set settlement_pending_tzs = 0, updated_at = now()
      where id = ${merchant.merchant_id} and settlement_pending_tzs >= ${MIN_SETTLEMENT_TZS}
      returning id
    `
    if (!claimed.length) continue

    // postgres.js returns numeric/int8 columns as strings — coerce before any
    // arithmetic, or `+` becomes string concatenation ("7000" + 1500 → "70001500").
    const batchTzs = Number(merchant.settlement_pending_tzs)
    // Gross up so the recipient nets batchTzs after Snippe flat fee + platform fee.
    const burnAmount = Math.ceil((batchTzs + SNIPPE_FLAT_FEE_TZS) / (1 - PLATFORM_FEE_PCT))
    const platformFeeTzs = burnAmount - batchTzs - SNIPPE_FLAT_FEE_TZS

    // Resolve the merchant's synthetic platform user + base wallet (created on
    // first collection). Restore the pot and skip if missing so it retries.
    const syntheticNeonId = `merchant_${merchant.wallet_address.toLowerCase()}`
    const [userRow] = await sql<{ id: string }[]>`
      select id from users where neon_auth_user_id = ${syntheticNeonId} limit 1
    `
    const userId = userRow?.id
    if (!userId) {
      await sql`
        update merchant_accounts
        set settlement_pending_tzs = settlement_pending_tzs + ${batchTzs}, updated_at = now()
        where id = ${merchant.merchant_id}
      `
      console.warn('[settle] merchant payout: user not found', { merchantId: merchant.merchant_id })
      continue
    }

    const [walletRow] = await sql<{ id: string }[]>`
      select id from wallets where user_id = ${userId} and chain = 'base' limit 1
    `
    const walletId = walletRow?.id
    if (!walletId) {
      await sql`
        update merchant_accounts
        set settlement_pending_tzs = settlement_pending_tzs + ${batchTzs}, updated_at = now()
        where id = ${merchant.merchant_id}
      `
      console.warn('[settle] merchant payout: wallet not found', { merchantId: merchant.merchant_id })
      continue
    }

    const [burnRow] = await sql<{ id: string }[]>`
      insert into burn_requests (
        user_id, wallet_id, chain, contract_address,
        amount_tzs, platform_fee_tzs, reason, status,
        requested_by_user_id, recipient_phone, created_at, updated_at
      ) values (
        ${userId}, ${walletId}, 'base', ${contractAddress},
        ${burnAmount}, ${platformFeeTzs}, 'merchant_auto_settlement', 'approved',
        ${userId}, ${merchant.settlement_phone}, now(), now()
      )
      returning id
    `
    const burnId = burnRow?.id
    if (!burnId) {
      await sql`
        update merchant_accounts
        set settlement_pending_tzs = settlement_pending_tzs + ${batchTzs}, updated_at = now()
        where id = ${merchant.merchant_id}
      `
      console.warn('[settle] merchant payout: burn insert failed', { merchantId: merchant.merchant_id })
      continue
    }

    await sql`
      update merchant_collections
      set settlement_status = 'processing', settlement_burn_request_id = ${burnId}, updated_at = now()
      where merchant_id = ${merchant.merchant_id} and settlement_status = 'queued'
    `

    console.log('[settle] merchant payout fired', { merchantId: merchant.merchant_id, batchTzs, burnAmount, burnId })
    fired += 1
  }
  return fired
}

/**
 * Phase C — Propagate burn_requests.payout_status back to the merchant's
 * collections once the burn worker (and Snippe webhook) resolve the payout.
 */
async function syncMerchantSettlementStatus(sql: SqlClient): Promise<number> {
  const jobs = await sql<{ collection_id: string; payout_status: string | null; burn_status: string }[]>`
    select mc.id as collection_id, br.payout_status, br.status as burn_status
    from merchant_collections mc
    join burn_requests br on br.id = mc.settlement_burn_request_id
    where mc.settlement_status = 'processing' and mc.settlement_burn_request_id is not null
    limit 25
  `

  let synced = 0
  for (const job of jobs) {
    let newStatus: string | null = null
    if (job.payout_status === 'completed') newStatus = 'completed'
    else if (job.payout_status === 'failed' || job.burn_status === 'failed') newStatus = 'failed'

    if (newStatus) {
      await sql`
        update merchant_collections
        set settlement_status = ${newStatus}, updated_at = now()
        where id = ${job.collection_id}
      `
      synced += 1
    }
  }
  return synced
}

export interface MerchantSettlementResult {
  payoutsFired: number
  statusesSynced: number
  errors: string[]
}

/**
 * Run one merchant-payout cycle: fire batch payouts (Phase B) → sync resolved
 * statuses (Phase C). The actual on-chain burn + Snippe payout is done by the
 * standalone burn worker, which consumes the approved burn_requests we insert.
 */
export async function runMerchantSettlement(sql: SqlClient): Promise<MerchantSettlementResult> {
  const result: MerchantSettlementResult = { payoutsFired: 0, statusesSynced: 0, errors: [] }

  try { result.payoutsFired = await fireBatchMerchantSettlements(sql) }
  catch (err) { result.errors.push(`merchantPayout: ${err instanceof Error ? err.message : String(err)}`) }

  try { result.statusesSynced = await syncMerchantSettlementStatus(sql) }
  catch (err) { result.errors.push(`merchantSync: ${err instanceof Error ? err.message : String(err)}`) }

  return result
}

export interface SettlementResult {
  queued: number
  repaymentsFired: number
  loansClosed: number
  errors: string[]
}

/**
 * Run one lender-settlement cycle: queue collections → fire repayments → close
 * loans. Each phase is isolated so one failing doesn't block the others.
 */
export async function runLenderSettlement(sql: SqlClient): Promise<SettlementResult> {
  const result: SettlementResult = { queued: 0, repaymentsFired: 0, loansClosed: 0, errors: [] }

  try { result.queued = await queueCollectionSettlements(sql) }
  catch (err) { result.errors.push(`queue: ${err instanceof Error ? err.message : String(err)}`) }

  try { result.repaymentsFired = await fireBatchLenderRepayments(sql) }
  catch (err) { result.errors.push(`repay: ${err instanceof Error ? err.message : String(err)}`) }

  try { result.loansClosed = await revertCompletedLoanAgreements(sql) }
  catch (err) { result.errors.push(`close: ${err instanceof Error ? err.message : String(err)}`) }

  return result
}
