/**
 * Merchant auto-settlement payout phases — ported from apps/worker/src/index.ts
 * (Phases B and C) so they can run inside the /api/cron/settle cycle. Phase B
 * converts an accumulated settlement pot into an approved burn request (which
 * /api/cron/process-burns executes: burn nTZS → mobile-money payout); Phase C
 * propagates the payout outcome back onto the merchant's collections so
 * dashboards show settled/failed instead of processing forever.
 */
import { getDb } from '@/lib/db'
import { grossUpSettlement, MIN_SETTLEMENT_TZS } from './payout-math'

type SqlClient = ReturnType<typeof getDb>['sql']

/**
 * Phase B — For each merchant whose settlement pot crossed the payout minimum,
 * atomically claim the full pot and insert a single approved, grossed-up burn
 * request; flip their queued collections to 'processing' linked to that burn.
 * Returns how many payout batches were fired.
 */
export async function fireBatchSettlements(sql: SqlClient): Promise<number> {
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
    // Atomically claim the pot so concurrent runs can't double-fire.
    const claimed = await sql<{ id: string }[]>`
      update merchant_accounts
      set settlement_pending_tzs = 0, updated_at = now()
      where id = ${merchant.merchant_id}
        and settlement_pending_tzs >= ${MIN_SETTLEMENT_TZS}
      returning id
    `
    if (!claimed.length) continue

    const batchTzs = merchant.settlement_pending_tzs
    const { burnAmountTzs, platformFeeTzs } = grossUpSettlement(batchTzs)

    const restorePot = async () => {
      await sql`
        update merchant_accounts
        set settlement_pending_tzs = settlement_pending_tzs + ${batchTzs}, updated_at = now()
        where id = ${merchant.merchant_id}
      `
    }

    // Resolve the merchant's synthetic user + wallet (created on first payment).
    const syntheticNeonId = `merchant_${merchant.wallet_address.toLowerCase()}`
    const userRows = await sql<{ id: string }[]>`
      select id from users where neon_auth_user_id = ${syntheticNeonId} limit 1
    `
    const userId = userRows[0]?.id
    if (!userId) {
      await restorePot()
      console.warn('[settle] batch settlement: merchant user not found', { merchantId: merchant.merchant_id })
      continue
    }

    const walletRows = await sql<{ id: string }[]>`
      select id from wallets where user_id = ${userId} and chain = 'base' limit 1
    `
    const walletId = walletRows[0]?.id
    if (!walletId) {
      await restorePot()
      console.warn('[settle] batch settlement: merchant wallet not found', { merchantId: merchant.merchant_id })
      continue
    }

    const burnRows = await sql<{ id: string }[]>`
      insert into burn_requests (
        user_id, wallet_id, chain, contract_address,
        amount_tzs, platform_fee_tzs, reason, status,
        requested_by_user_id, recipient_phone,
        created_at, updated_at
      ) values (
        ${userId}, ${walletId}, 'base', ${contractAddress},
        ${burnAmountTzs}, ${platformFeeTzs}, 'merchant_auto_settlement', 'approved',
        ${userId}, ${merchant.settlement_phone},
        now(), now()
      )
      returning id
    `
    const burnId = burnRows[0]?.id
    if (!burnId) {
      await restorePot()
      console.warn('[settle] batch settlement: failed to insert burn request', { merchantId: merchant.merchant_id })
      continue
    }

    await sql`
      update merchant_collections
      set settlement_status = 'processing',
          settlement_burn_request_id = ${burnId},
          updated_at = now()
      where merchant_id = ${merchant.merchant_id}
        and settlement_status = 'queued'
    `

    console.log('[settle] batch settlement fired', {
      merchantId: merchant.merchant_id, batchTzs, burnAmountTzs, burnRequestId: burnId, phone: merchant.settlement_phone,
    })
    fired += 1
  }
  return fired
}

/**
 * Phase C — Propagate burn/payout outcomes back onto collections stuck in
 * 'processing'. Returns how many were updated.
 */
export async function syncMerchantSettlementStatus(sql: SqlClient): Promise<number> {
  const jobs = await sql<{
    collection_id: string
    payout_status: string | null
    burn_status: string
  }[]>`
    select mc.id as collection_id, br.payout_status, br.status as burn_status
    from merchant_collections mc
    join burn_requests br on br.id = mc.settlement_burn_request_id
    where mc.settlement_status = 'processing'
      and mc.settlement_burn_request_id is not null
    limit 10
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
      console.log('[settle] settlement status synced', { collectionId: job.collection_id, newStatus })
      synced += 1
    }
  }
  return synced
}
