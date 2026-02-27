import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { ethers } from 'ethers'

import { createDbClient } from '@ntzs/db'
import { sleep } from '@ntzs/shared'
import { processBurnJob } from './burn-worker.js'

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

/**
 * Poll Snippe for completed payments that are still in "submitted" status
 * This is a fallback in case webhooks don't fire
 */
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
    process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA ??
    process.env.NTZS_CONTRACT_ADDRESS_BASE ??
    ''

  if (!contractAddress) {
    throw new Error('Missing env var: NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA')
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
  const baseSepoliaRpcUrl = requiredEnv('BASE_SEPOLIA_RPC_URL')
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
    // Poll Snippe for completed payments (webhook fallback)
    try {
      const { sql } = createDbClient(databaseUrl)
      await pollSnippeForCompletedPayments(sql)
      await sql.end({ timeout: 5 })
    } catch (err) {
      console.warn('[worker] Snippe poll error:', err instanceof Error ? err.message : err)
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
      const rpcUrl = requiredEnv('BASE_SEPOLIA_RPC_URL')
      const privateKey = requiredEnv('MINTER_PRIVATE_KEY')
      const apiBaseUrl = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''
      await processBurnJob(databaseUrl, rpcUrl, privateKey, SNIPPE_API_KEY, apiBaseUrl)
    } catch (err) {
      console.error('[worker] processBurnJob error:', err instanceof Error ? err.message : err)
    }

    await sleep(pollMs)
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal', err)
  process.exit(1)
})
