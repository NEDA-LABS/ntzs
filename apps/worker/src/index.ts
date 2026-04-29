import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { ethers } from 'ethers'

import { createDbClient } from '@ntzs/db'
import { sleep } from '@ntzs/shared'
import { processBurnJob } from './burn-worker.js'
import { processLpEarnings } from './lp-earnings-worker.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

dotenv.config({ path: path.join(repoRoot, '.env') })
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true })

// Must be after dotenv.config()
const SNIPPE_API_KEY = process.env.SNIPPE_API_KEY || ''
const SNIPPE_BASE_URL = 'https://api.snippe.sh'

const SAFE_MINT_THRESHOLD_TZS = 100000

const NTZS_ABI = [
  'function mint(address to, uint256 amount)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

function requiredEnv(name: string) {
  const v = process.env[name]
  if (!v) {
    throw new Error(`Missing env var: ${name}`)
  }
  return v
}

function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

async function reserveDailyIssuance(
  sql: ReturnType<typeof createDbClient>['sql'],
  amountTzs: number
): Promise<boolean> {
  const today = getTodayUTC()
  const defaultCap = Number(process.env.DAILY_ISSUANCE_CAP_TZS ?? '100000000')

  // Ensure today's row exists
  await sql`
    insert into daily_issuance (day, cap_tzs, reserved_tzs, issued_tzs, updated_at)
    values (${today}, ${defaultCap}, 0, 0, now())
    on conflict (day) do nothing
  `

  // Atomically reserve if capacity available
  const result = await sql<{ success: boolean }[]>`
    update daily_issuance
    set reserved_tzs = reserved_tzs + ${amountTzs}, updated_at = now()
    where day = ${today}
      and (reserved_tzs + ${amountTzs}) <= cap_tzs
    returning true as success
  `

  return result.length > 0
}

async function commitIssuance(
  sql: ReturnType<typeof createDbClient>['sql'],
  amountTzs: number
): Promise<void> {
  const today = getTodayUTC()

  await sql`
    update daily_issuance
    set issued_tzs = issued_tzs + ${amountTzs},
        reserved_tzs = reserved_tzs - ${amountTzs},
        updated_at = now()
    where day = ${today}
  `
}

async function releaseReservation(
  sql: ReturnType<typeof createDbClient>['sql'],
  amountTzs: number
): Promise<void> {
  const today = getTodayUTC()

  await sql`
    update daily_issuance
    set reserved_tzs = greatest(0, reserved_tzs - ${amountTzs}),
        updated_at = now()
    where day = ${today}
  `
}

async function logAudit(
  sql: ReturnType<typeof createDbClient>['sql'],
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await sql`
    insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
    values (${action}, ${entityType}, ${entityId}, ${JSON.stringify(metadata)}::jsonb, now())
  `
}

const SNIPPE_FLAT_FEE_TZS = 1500
const PLATFORM_FEE_PCT = 0.005
const MIN_SETTLEMENT_TZS = 5000

/**
 * Phase A — Queue collections.
 *
 * For each minted collection with settlement pending, add the merchant's share
 * to their running settlement_pending_tzs accumulator and mark the collection
 * as 'queued'. No payout fires here — collections stack up until the pot is
 * large enough for Snippe to accept it.
 */
async function queueCollectionSettlements(sql: ReturnType<typeof createDbClient>['sql']) {
  const collections = await sql<{
    collection_id: string
    merchant_id: string
    amount_tzs: number
    settle_pct: number
  }[]>`
    select mc.id as collection_id, mc.merchant_id, mc.amount_tzs, mc.settle_pct
    from merchant_collections mc
    join merchant_accounts ma on ma.id = mc.merchant_id
    where mc.collection_status = 'minted'
      and mc.settlement_status = 'pending'
      and mc.settle_pct > 0
      and ma.settlement_phone is not null
      and ma.is_active = true
    order by mc.created_at asc
    limit 20
  `

  for (const col of collections) {
    // Claim atomically
    const claimed = await sql<{ id: string }[]>`
      update merchant_collections
      set settlement_status = 'queued', updated_at = now()
      where id = ${col.collection_id} and settlement_status = 'pending'
      returning id
    `
    if (!claimed.length) continue

    const netTzs = Math.floor((col.amount_tzs * col.settle_pct) / 100)

    // Increment the merchant's accumulator and record the per-collection amount
    await sql`
      update merchant_accounts
      set settlement_pending_tzs = settlement_pending_tzs + ${netTzs},
          updated_at = now()
      where id = ${col.merchant_id}
    `

    await sql`
      update merchant_collections
      set settlement_amount_tzs = ${netTzs},
          updated_at = now()
      where id = ${col.collection_id}
    `

    console.log('[worker] settlement queued', {
      collectionId: col.collection_id,
      netTzs,
    })
  }
}

/**
 * Phase B — Fire batch payouts.
 *
 * For each merchant whose accumulated settlement_pending_tzs has crossed the
 * PSP minimum, atomically claim the full pot and insert a single approved
 * burn_request. The burn worker picks it up on the next cycle and pays out
 * via Snippe. All 'queued' collections for that merchant flip to 'processing'.
 *
 * When we switch to a better PSP, only MIN_SETTLEMENT_TZS needs to change.
 */
async function fireBatchSettlements(sql: ReturnType<typeof createDbClient>['sql']) {
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  if (!contractAddress) return

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

  for (const merchant of merchants) {
    // Atomically claim the full accumulated pot — prevents double-fire if two
    // worker instances run simultaneously
    const claimed = await sql<{ claimed_tzs: number }[]>`
      update merchant_accounts
      set settlement_pending_tzs = 0, updated_at = now()
      where id = ${merchant.merchant_id}
        and settlement_pending_tzs >= ${MIN_SETTLEMENT_TZS}
      returning settlement_pending_tzs as claimed_tzs
    `
    // Note: settlement_pending_tzs in RETURNING is the NEW value (0) after the update.
    // We need the old value — use the one we already read from the SELECT above.
    if (!claimed.length) continue  // another worker claimed it first

    const batchTzs = merchant.settlement_pending_tzs

    // Gross up for Snippe flat fee + platform fee
    const burnAmount = Math.ceil((batchTzs + SNIPPE_FLAT_FEE_TZS) / (1 - PLATFORM_FEE_PCT))
    const platformFeeTzs = burnAmount - batchTzs - SNIPPE_FLAT_FEE_TZS

    // Resolve synthetic user + wallet (created on first payment)
    const syntheticNeonId = `merchant_${merchant.wallet_address.toLowerCase()}`
    const userRows = await sql<{ id: string }[]>`
      select id from users where neon_auth_user_id = ${syntheticNeonId} limit 1
    `
    const userId = userRows[0]?.id

    if (!userId) {
      // Restore the pot so it can be retried
      await sql`
        update merchant_accounts
        set settlement_pending_tzs = settlement_pending_tzs + ${batchTzs}, updated_at = now()
        where id = ${merchant.merchant_id}
      `
      console.warn('[worker] batch settlement: merchant user not found', { merchantId: merchant.merchant_id })
      continue
    }

    const walletRows = await sql<{ id: string }[]>`
      select id from wallets where user_id = ${userId} and chain = 'base' limit 1
    `
    const walletId = walletRows[0]?.id

    if (!walletId) {
      await sql`
        update merchant_accounts
        set settlement_pending_tzs = settlement_pending_tzs + ${batchTzs}, updated_at = now()
        where id = ${merchant.merchant_id}
      `
      console.warn('[worker] batch settlement: merchant wallet not found', { merchantId: merchant.merchant_id })
      continue
    }

    // Insert pre-approved burn — burn worker claims it on the next poll
    const burnRows = await sql<{ id: string }[]>`
      insert into burn_requests (
        user_id, wallet_id, chain, contract_address,
        amount_tzs, platform_fee_tzs, reason, status,
        requested_by_user_id, recipient_phone,
        created_at, updated_at
      ) values (
        ${userId}, ${walletId}, 'base', ${contractAddress},
        ${burnAmount}, ${platformFeeTzs}, 'merchant_auto_settlement', 'approved',
        ${userId}, ${merchant.settlement_phone},
        now(), now()
      )
      returning id
    `
    const burnId = burnRows[0]?.id

    if (!burnId) {
      // Restore pot on insert failure
      await sql`
        update merchant_accounts
        set settlement_pending_tzs = settlement_pending_tzs + ${batchTzs}, updated_at = now()
        where id = ${merchant.merchant_id}
      `
      console.warn('[worker] batch settlement: failed to insert burn request', { merchantId: merchant.merchant_id })
      continue
    }

    // Move all this merchant's queued collections into 'processing', linked to this burn
    await sql`
      update merchant_collections
      set settlement_status = 'processing',
          settlement_burn_request_id = ${burnId},
          updated_at = now()
      where merchant_id = ${merchant.merchant_id}
        and settlement_status = 'queued'
    `

    console.log('[worker] batch settlement fired', {
      merchantId: merchant.merchant_id,
      batchTzs,
      burnAmount,
      burnRequestId: burnId,
      phone: merchant.settlement_phone,
    })
  }
}

/**
 * Propagate burn_requests.payout_status back to merchant_collections.settlement_status
 * for collections whose auto-settlement burn has been processed.
 */
async function syncMerchantSettlementStatus(sql: ReturnType<typeof createDbClient>['sql']) {
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

  for (const job of jobs) {
    let newStatus: string | null = null

    if (job.payout_status === 'completed') {
      newStatus = 'completed'
    } else if (job.payout_status === 'failed' || job.burn_status === 'failed') {
      newStatus = 'failed'
    }

    if (newStatus) {
      await sql`
        update merchant_collections
        set settlement_status = ${newStatus}, updated_at = now()
        where id = ${job.collection_id}
      `
      console.log('[worker] settlement status synced', { collectionId: job.collection_id, newStatus })
    }
  }
}

/**
 * Poll Snippe for payout completion on burn requests still in 'pending' payout status.
 * This is a fallback in case the payout webhook doesn't fire.
 */
async function pollSnippeForCompletedPayouts(sql: ReturnType<typeof createDbClient>['sql']) {
  if (!SNIPPE_API_KEY) {
    return
  }

  const pendingPayouts = await sql<{ id: string; payout_reference: string; amount_tzs: number }[]>`
    select id, payout_reference, amount_tzs from burn_requests
    where status = 'burned'
      and payout_status = 'pending'
      and payout_reference is not null
      and updated_at < now() - interval '30 seconds'
    order by updated_at asc
    limit 5
  `

  for (const row of pendingPayouts) {
    try {
      const response = await fetch(
        `${SNIPPE_BASE_URL}/v1/payouts/${row.payout_reference}`,
        { headers: { 'Authorization': `Bearer ${SNIPPE_API_KEY}` } }
      )

      if (!response.ok) continue

      const result = await response.json() as {
        status: string
        data?: {
          status: string
          failure_reason?: string
        }
      }

      if (result.status === 'success' && result.data?.status === 'completed') {
        await sql`
          update burn_requests
          set payout_status = 'completed', updated_at = now()
          where id = ${row.id} and payout_status = 'pending'
        `

        console.log('[worker] polled Snippe, payout completed', {
          burnRequestId: row.id,
          reference: row.payout_reference,
        })
      } else if (result.data?.status === 'failed' || result.data?.status === 'reversed') {
        await sql`
          update burn_requests
          set payout_status = 'failed',
              payout_error = ${result.data.failure_reason ?? 'Payout failed (polled)'},
              updated_at = now()
          where id = ${row.id} and payout_status = 'pending'
        `

        console.log('[worker] polled Snippe, payout failed', {
          burnRequestId: row.id,
          reason: result.data.failure_reason,
        })
      }
    } catch (err) {
      console.warn('[worker] Snippe payout poll error for', row.id, err instanceof Error ? err.message : err)
    }
  }
}

async function pollSnippeForCompletedPayments(sql: ReturnType<typeof createDbClient>['sql']) {
  if (!SNIPPE_API_KEY) {
    return // Skip if no API key configured
  }

  // Find submitted Snippe deposits older than 30 seconds that have a psp_reference
  const pendingDeposits = await sql<{ id: string; psp_reference: string; amount_tzs: number }[]>`
    select id, psp_reference, amount_tzs from deposit_requests
    where status = 'submitted'
      and payment_provider = 'snippe'
      and psp_reference is not null
      and created_at < now() - interval '30 seconds'
    order by created_at asc
    limit 5
  `

  for (const deposit of pendingDeposits) {
    try {
      const response = await fetch(
        `${SNIPPE_BASE_URL}/v1/payments/${deposit.psp_reference}`,
        { headers: { 'Authorization': `Bearer ${SNIPPE_API_KEY}` } }
      )

      if (!response.ok) continue

      const result = await response.json() as {
        status: string
        data?: {
          status: string
          reference: string
          channel?: { provider: string }
        }
      }

      if (result.status === 'success' && result.data?.status === 'completed') {
        const newStatus = deposit.amount_tzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'

        await sql`
          update deposit_requests
          set status = ${newStatus},
              psp_channel = ${result.data.channel?.provider ?? null},
              fiat_confirmed_at = now(),
              updated_at = now()
          where id = ${deposit.id} and status = 'submitted'
        `

        console.log('[worker] polled Snippe, found completed payment', {
          depositId: deposit.id,
          reference: deposit.psp_reference,
          newStatus,
        })
      } else if (result.data?.status === 'failed' || result.data?.status === 'expired' || result.data?.status === 'voided') {
        await sql`
          update deposit_requests
          set status = 'rejected', updated_at = now()
          where id = ${deposit.id} and status = 'submitted'
        `
        console.log('[worker] polled Snippe, payment failed/expired', { depositId: deposit.id })
      }
    } catch (err) {
      // Silently continue on errors - will retry next poll
      console.warn('[worker] Snippe poll error for', deposit.id, err instanceof Error ? err.message : err)
    }
  }
}

async function claimNextMintJob(sql: ReturnType<typeof createDbClient>['sql']) {
  const contractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE ??
    ''

  if (!contractAddress) {
    throw new Error('Missing env var: NTZS_CONTRACT_ADDRESS_BASE')
  }

  const rows = await sql<
    {
      id: string
      wallet_id: string
      amount_tzs: number
      chain: 'base'
    }[]
  >`
    update deposit_requests
    set status = 'mint_processing', updated_at = now()
    where id = (
      select id
      from deposit_requests
      where status = 'mint_pending'
        and chain = 'base'
      order by created_at asc
      for update skip locked
      limit 1
    )
    returning id, wallet_id, amount_tzs, chain
  `

  const job = rows[0]
  if (!job) return null

  await sql`
    insert into mint_transactions (deposit_request_id, chain, contract_address, status, created_at, updated_at)
    values (${job.id}, ${job.chain}, ${contractAddress}, 'processing', now(), now())
    on conflict (deposit_request_id)
    do update set status = 'processing', contract_address = excluded.contract_address, updated_at = now()
  `

  return { ...job, contractAddress }
}

async function processOne() {
  const databaseUrl = requiredEnv('DATABASE_URL')
  const baseSepoliaRpcUrl = requiredEnv('BASE_RPC_URL')
  const minterPrivateKey = requiredEnv('MINTER_PRIVATE_KEY')

  const { sql } = createDbClient(databaseUrl)

  const job = await claimNextMintJob(sql)
  if (!job) {
    await sql.end({ timeout: 5 })
    return false
  }

  // Check daily issuance cap before proceeding
  const canReserve = await reserveDailyIssuance(sql, job.amount_tzs)
  if (!canReserve) {
    // Release the job back to pending - daily cap reached
    await sql`
      update deposit_requests
      set status = 'mint_pending', updated_at = now()
      where id = ${job.id}
    `
    await sql`
      update mint_transactions
      set status = 'cap_exceeded', error = 'Daily issuance cap reached', updated_at = now()
      where deposit_request_id = ${job.id}
    `
    // eslint-disable-next-line no-console
    console.warn('[worker] daily cap reached, deferring', { depositRequestId: job.id, amountTzs: job.amount_tzs })
    await sql.end({ timeout: 5 })
    return true
  }

  try {
    const walletRows = await sql<{ address: string }[]>`
      select address from wallets where id = ${job.wallet_id} limit 1
    `
    const walletAddress = walletRows[0]?.address

    if (!walletAddress) {
      throw new Error('Missing wallet address for deposit request')
    }

    const provider = new ethers.JsonRpcProvider(baseSepoliaRpcUrl)
    const signer = new ethers.Wallet(minterPrivateKey, provider)
    const token = new ethers.Contract(job.contractAddress, NTZS_ABI, signer)

    const minterRole: string = await token.MINTER_ROLE()
    const hasMinter: boolean = await token.hasRole(minterRole, await signer.getAddress())
    if (!hasMinter) {
      throw new Error('Minter key does not have MINTER_ROLE on contract')
    }

    const amountWei = BigInt(String(job.amount_tzs)) * 10n ** 18n

    const tx = await token.mint(walletAddress, amountWei)

    await sql`
      update mint_transactions
      set tx_hash = ${tx.hash}, status = 'submitted', updated_at = now()
      where deposit_request_id = ${job.id}
    `

    await tx.wait(1)

    // Commit the issuance to daily totals
    await commitIssuance(sql, job.amount_tzs)

    await sql`
      update mint_transactions
      set status = 'minted', updated_at = now()
      where deposit_request_id = ${job.id}
    `
    await sql`
      update deposit_requests
      set status = 'minted', updated_at = now()
      where id = ${job.id}
    `

    // Audit log
    await logAudit(sql, 'mint_completed', 'deposit_request', job.id, {
      amountTzs: job.amount_tzs,
      walletAddress,
      txHash: tx.hash,
      chain: job.chain,
      contractAddress: job.contractAddress,
    })

    // eslint-disable-next-line no-console
    console.log('[worker] minted', { depositRequestId: job.id, txHash: tx.hash, amountTzs: job.amount_tzs })

    await sql.end({ timeout: 5 })
    return true
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    // Release the reservation since mint failed
    await releaseReservation(sql, job.amount_tzs)

    await sql`
      update mint_transactions
      set status = 'failed', error = ${errorMessage}, updated_at = now()
      where deposit_request_id = ${job.id}
    `
    await sql`
      update deposit_requests
      set status = 'mint_failed', updated_at = now()
      where id = ${job.id}
    `

    // Audit log for failure
    await logAudit(sql, 'mint_failed', 'deposit_request', job.id, {
      amountTzs: job.amount_tzs,
      error: errorMessage,
      chain: job.chain,
    })

    // eslint-disable-next-line no-console
    console.error('[worker] mint_failed', { depositRequestId: job.id, error: errorMessage })

    await sql.end({ timeout: 5 })
    return true
  }
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('[worker] started')

  const pollMs = Number(process.env.WORKER_POLL_MS ?? '5000')
  const databaseUrl = requiredEnv('DATABASE_URL')

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Poll Snippe for completed deposit payments (webhook fallback)
    try {
      const { sql } = createDbClient(databaseUrl)
      await pollSnippeForCompletedPayments(sql)
      await sql.end({ timeout: 5 })
    } catch (err) {
      console.warn('[worker] Snippe deposit poll error:', err instanceof Error ? err.message : err)
    }

    // Poll Snippe for completed payouts on burned requests (webhook fallback)
    try {
      const { sql } = createDbClient(databaseUrl)
      await pollSnippeForCompletedPayouts(sql)
      await sql.end({ timeout: 5 })
    } catch (err) {
      console.warn('[worker] Snippe payout poll error:', err instanceof Error ? err.message : err)
    }

    // Process mint jobs with error recovery
    try {
      await processOne()
    } catch (err) {
      console.error('[worker] processOne error:', err instanceof Error ? err.message : err)
      // Wait a bit longer on errors before retrying
      await sleep(10000)
    }

    // Process burn jobs (off-ramp: burn on-chain + Snippe payout)
    try {
      const rpcUrl = requiredEnv('BASE_RPC_URL')
      const privateKey = process.env.BURNER_PRIVATE_KEY || requiredEnv('MINTER_PRIVATE_KEY')
      const apiBaseUrl = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''
      const platformTreasury = (process.env.PLATFORM_TREASURY_ADDRESS || '').replace(/^["']|["']$/g, '')
      await processBurnJob(databaseUrl, rpcUrl, privateKey, SNIPPE_API_KEY, apiBaseUrl, platformTreasury)
    } catch (err) {
      console.error('[worker] processBurnJob error:', err instanceof Error ? err.message : err)
    }

    // Allocate LP earnings from solver wallet balance delta (every 5 min)
    try {
      const rpcUrl = process.env.BASE_RPC_URL
      if (rpcUrl) await processLpEarnings(databaseUrl, rpcUrl)
    } catch (err) {
      console.warn('[worker] LP earnings error:', err instanceof Error ? err.message : err)
    }

    // Phase A: add each minted collection's share to the merchant's running pot
    try {
      const { sql } = createDbClient(databaseUrl)
      await queueCollectionSettlements(sql)
      await sql.end({ timeout: 5 })
    } catch (err) {
      console.warn('[worker] queue-settlements error:', err instanceof Error ? err.message : err)
    }

    // Phase B: fire a batch payout for any merchant whose pot hit the PSP minimum
    try {
      const { sql } = createDbClient(databaseUrl)
      await fireBatchSettlements(sql)
      await sql.end({ timeout: 5 })
    } catch (err) {
      console.warn('[worker] batch-settlements error:', err instanceof Error ? err.message : err)
    }

    // Phase C: propagate burn payout status back to merchant_collections
    try {
      const { sql } = createDbClient(databaseUrl)
      await syncMerchantSettlementStatus(sql)
      await sql.end({ timeout: 5 })
    } catch (err) {
      console.warn('[worker] settlement-sync error:', err instanceof Error ? err.message : err)
    }

    await sleep(pollMs)
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal', err)
  process.exit(1)
})
