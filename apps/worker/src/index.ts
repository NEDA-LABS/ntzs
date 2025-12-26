import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { ethers } from 'ethers'

import { createDbClient } from '@ntzs/db'
import { sleep } from '@ntzs/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

dotenv.config({ path: path.join(repoRoot, '.env') })
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true })

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

    // eslint-disable-next-line no-console
    console.log('[worker] minted', { depositRequestId: job.id, txHash: tx.hash })

    await sql.end({ timeout: 5 })
    return true
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

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

    // eslint-disable-next-line no-console
    console.error('[worker] mint_failed', { depositRequestId: job.id, error: errorMessage })

    await sql.end({ timeout: 5 })
    return true
  }
}

async function main() {
  // Placeholder worker loop. We’ll replace this with:
  // - DB polling for mint_pending deposits
  // - limit checks (daily TZS cap)
  // - Base/BNB mint tx submission
  // - status updates + audit logs
  //
  // Keeping it simple for the first commit so the worker can run.
  // eslint-disable-next-line no-console
  console.log('[worker] started')

  const pollMs = Number(process.env.WORKER_POLL_MS ?? '5000')

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await processOne()
    await sleep(pollMs)
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal', err)
  process.exit(1)
})
