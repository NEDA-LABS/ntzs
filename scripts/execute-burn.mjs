/**
 * One-shot burn executor — processes a single approved burn_request by ID.
 * Usage: node scripts/execute-burn.mjs <burn_request_id>
 */
import { createRequire } from 'module'
import { ethers } from 'ethers'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const dotenv = require('dotenv')
dotenv.config({ path: resolve(__dirname, '../.env') })
dotenv.config({ path: resolve(__dirname, '../.env.local'), override: true })

import postgres from 'postgres'

const burnRequestId = process.argv[2]
if (!burnRequestId) {
  console.error('Usage: node scripts/execute-burn.mjs <burn_request_id>')
  process.exit(1)
}

const DATABASE_URL = process.env.DATABASE_URL
const RPC_URL = process.env.BASE_RPC_URL
const PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY
const CONTRACT_ADDRESS = process.env.NTZS_CONTRACT_ADDRESS_BASE

if (!DATABASE_URL || !RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error('Missing required env vars: DATABASE_URL, BASE_RPC_URL, MINTER_PRIVATE_KEY, NTZS_CONTRACT_ADDRESS_BASE')
  process.exit(1)
}

const BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
]

const sql = postgres(DATABASE_URL, { ssl: 'require' })

async function main() {
  // Fetch the burn request
  const rows = await sql`
    SELECT br.id, br.status, br.amount_tzs, br.recipient_phone, w.address as wallet_address
    FROM burn_requests br
    JOIN wallets w ON w.id = br.wallet_id
    WHERE br.id = ${burnRequestId}
    LIMIT 1
  `

  const job = rows[0]
  if (!job) {
    console.error('Burn request not found:', burnRequestId)
    process.exit(1)
  }

  console.log('Burn request:', {
    id: job.id,
    status: job.status,
    amountTzs: job.amount_tzs,
    walletAddress: job.wallet_address,
  })

  if (job.status !== 'approved') {
    console.error(`Burn request is not in approved state (current: ${job.status})`)
    process.exit(1)
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const signer = new ethers.Wallet(PRIVATE_KEY, provider)
  const token = new ethers.Contract(CONTRACT_ADDRESS, BURN_ABI, signer)

  // Verify burner role
  const burnerRole = await token.BURNER_ROLE()
  const hasBurner = await token.hasRole(burnerRole, await signer.getAddress())
  if (!hasBurner) {
    console.error('Signer does not have BURNER_ROLE on contract')
    process.exit(1)
  }

  const amountWei = BigInt(String(job.amount_tzs)) * 10n ** 18n

  // Mark as submitted
  await sql`
    UPDATE burn_requests SET status = 'burn_submitted', updated_at = now() WHERE id = ${job.id}
  `

  console.log(`Burning ${job.amount_tzs} TZS from ${job.wallet_address}...`)
  const tx = await token.burn(job.wallet_address, amountWei)
  console.log('TX submitted:', tx.hash)

  await sql`
    UPDATE burn_requests SET tx_hash = ${tx.hash}, updated_at = now() WHERE id = ${job.id}
  `

  await tx.wait(1)
  console.log('TX confirmed.')

  await sql`
    UPDATE burn_requests SET status = 'burned', updated_at = now() WHERE id = ${job.id}
  `

  console.log(`Done. Burned ${job.amount_tzs} TZS from ${job.wallet_address}.`)
  await sql.end()
}

main().catch(async (err) => {
  console.error('Error:', err.message)
  await sql.end()
  process.exit(1)
})
