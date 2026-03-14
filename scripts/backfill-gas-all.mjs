/**
 * Backfill ETH gas for all provisioned user wallets with 0 ETH balance.
 *
 * Safe to run multiple times — skips wallets that already have ETH.
 * Run AFTER funding the relayer wallet.
 */
import 'dotenv/config'
import pg from 'pg'
import { ethers } from 'ethers'

const { Client } = pg
const GAS_AMOUNT = '0.0005'

async function main() {
  const rpcUrl = process.env.BASE_RPC_URL
  const relayerKey = process.env.RELAYER_PRIVATE_KEY

  if (!rpcUrl) throw new Error('BASE_RPC_URL is required')
  if (!relayerKey) throw new Error('RELAYER_PRIVATE_KEY is required')

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const relayer = new ethers.Wallet(relayerKey, provider)

  const relayerBalance = await provider.getBalance(relayer.address)
  console.log(`Relayer: ${relayer.address}`)
  console.log(`Relayer balance: ${ethers.formatEther(relayerBalance)} ETH`)

  if (relayerBalance === BigInt(0)) {
    console.error('\nRelayer has 0 ETH — fund it first then re-run this script.')
    process.exit(1)
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const { rows } = await client.query(`
    SELECT u.email, w.address
    FROM wallets w
    JOIN users u ON u.id = w.user_id
    WHERE w.chain = 'base'
      AND w.address NOT LIKE '0x_pending_%'
    ORDER BY w.created_at ASC
  `)

  await client.end()

  console.log(`\nChecking ${rows.length} wallets for gas...\n`)

  let funded = 0
  let skipped = 0

  for (const row of rows) {
    const bal = await provider.getBalance(row.address)
    if (bal > BigInt(0)) {
      console.log(`  ⏭  ${row.email} — already has ETH, skipping`)
      skipped++
      continue
    }

    try {
      const tx = await relayer.sendTransaction({
        to: row.address,
        value: ethers.parseEther(GAS_AMOUNT),
      })
      await tx.wait()
      console.log(`  ✓  ${row.email} | ${row.address} | +${GAS_AMOUNT} ETH | tx: ${tx.hash}`)
      funded++
    } catch (err) {
      console.error(`  ✗  ${row.email} | ${row.address} — ${err.message}`)
    }
  }

  const finalRelayerBal = await provider.getBalance(relayer.address)
  console.log(`\nDone. Funded: ${funded}, Skipped: ${skipped}`)
  console.log(`Relayer remaining: ${ethers.formatEther(finalRelayerBal)} ETH`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
