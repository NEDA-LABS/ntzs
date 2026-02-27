/**
 * backfill-gas.mjs
 *
 * One-off script to prefund all existing partner-managed user wallets
 * that have 0 ETH on Base mainnet.
 *
 * Usage:
 *   node scripts/backfill-gas.mjs
 *   node scripts/backfill-gas.mjs --dry-run   (check balances, no sends)
 *   node scripts/backfill-gas.mjs --amount 0.0003  (custom amount per wallet)
 *
 * Requires in environment (.env):
 *   DATABASE_URL, BASE_RPC_URL, RELAYER_PRIVATE_KEY
 */

import { ethers } from 'ethers'
import postgres from 'postgres'
import * as dotenv from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })
dotenv.config({ path: resolve(__dirname, '../.env.local'), override: true })

const DRY_RUN = process.argv.includes('--dry-run')
const amountArg = process.argv.find(a => a.startsWith('--amount'))
const AMOUNT_ETH = amountArg ? amountArg.split('=')[1] ?? process.argv[process.argv.indexOf('--amount') + 1] : '0.0005'

const DATABASE_URL = process.env.DATABASE_URL
const RPC_URL = process.env.BASE_RPC_URL
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY

if (!DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1) }
if (!RPC_URL)      { console.error('BASE_RPC_URL is not set'); process.exit(1) }
if (!RELAYER_KEY && !DRY_RUN) { console.error('RELAYER_PRIVATE_KEY is not set'); process.exit(1) }

const provider = new ethers.JsonRpcProvider(RPC_URL)
const relayer = DRY_RUN ? null : new ethers.Wallet(RELAYER_KEY, provider)
const amountWei = ethers.parseEther(AMOUNT_ETH)

async function main() {
  const sql = postgres(DATABASE_URL, { ssl: 'require' })

  console.log(`\n=== nTZS Gas Backfill${DRY_RUN ? ' (DRY RUN)' : ''} ===`)
  console.log(`Amount per wallet : ${AMOUNT_ETH} ETH`)
  console.log(`RPC               : ${RPC_URL.slice(0, 40)}...`)

  if (relayer) {
    const relayerBalance = await provider.getBalance(relayer.address)
    console.log(`Relayer address   : ${relayer.address}`)
    console.log(`Relayer balance   : ${ethers.formatEther(relayerBalance)} ETH\n`)

    if (relayerBalance < amountWei) {
      console.error('Relayer has insufficient ETH to fund even one wallet. Aborting.')
      process.exit(1)
    }
  }

  // Fetch all wallets belonging to partner-managed users (have a partner_users entry)
  const rows = await sql`
    SELECT DISTINCT w.address, w.user_id
    FROM wallets w
    INNER JOIN partner_users pu ON pu.user_id = w.user_id
    WHERE w.chain = 'base'
      AND w.address NOT LIKE '0x_pending_%'
    ORDER BY w.address
  `

  console.log(`Found ${rows.length} partner-managed wallets on Base\n`)

  let funded = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const address = row.address
    const balance = await provider.getBalance(address)

    if (balance > BigInt(0)) {
      console.log(`SKIP  ${address}  (${ethers.formatEther(balance)} ETH already)`)
      skipped++
      continue
    }

    if (DRY_RUN) {
      console.log(`WOULD FUND  ${address}  (0 ETH → send ${AMOUNT_ETH} ETH)`)
      funded++
      continue
    }

    try {
      // Check relayer still has enough
      const relayerBalance = await provider.getBalance(relayer.address)
      if (relayerBalance < amountWei) {
        console.error(`\nRelayer ran out of ETH after ${funded} wallets funded. Stopping.`)
        break
      }

      process.stdout.write(`SENDING  ${address} ... `)
      const tx = await relayer.sendTransaction({ to: address, value: amountWei })
      process.stdout.write(`tx: ${tx.hash}\n`)
      process.stdout.write(`         waiting for confirmation`)
      const timer = setInterval(() => process.stdout.write('.'), 1000)
      await tx.wait()
      clearInterval(timer)
      const newBal = await provider.getBalance(address)
      console.log(` ✓  balance now: ${ethers.formatEther(newBal)} ETH`)
      funded++
    } catch (err) {
      console.error(`\nFAIL  ${address}  ${err.message}`)
      failed++
    }
  }

  await sql.end()

  console.log(`\n=== Summary ===`)
  console.log(`Funded  : ${funded}`)
  console.log(`Skipped : ${skipped} (already had ETH)`)
  console.log(`Failed  : ${failed}`)
  if (!DRY_RUN && funded > 0) {
    console.log(`ETH spent : ~${(funded * parseFloat(AMOUNT_ETH)).toFixed(4)} ETH`)
  }
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
