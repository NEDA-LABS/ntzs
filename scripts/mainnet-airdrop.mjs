/**
 * Mainnet Airdrop — snapshot live Sepolia balances and mint equivalent on mainnet.
 *
 * Source of truth: actual on-chain balance on the Sepolia contract.
 * This correctly reflects withdrawals/burns — users who cashed out get nothing.
 *
 * Safe to re-run: skips wallets already funded on mainnet.
 *
 * Run: node scripts/mainnet-airdrop.mjs [--dry-run]
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import pg from 'pg'
import { ethers } from 'ethers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true })

const { Client } = pg
const DRY_RUN = process.argv.includes('--dry-run')

const TOKEN_ABI = [
  'function mint(address to, uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
]

const SEPOLIA_CONTRACT = '0x6A9525A5C82F92E10741Fcdcb16DbE9111630077'

async function main() {
  const mainnetRpc = process.env.BASE_RPC_URL
  const sepoliaRpc = process.env.BASE_SEPOLIA_RPC_URL
  const mainnetContract = process.env.NTZS_CONTRACT_ADDRESS_BASE
  const minterKey = process.env.MINTER_PRIVATE_KEY
  const databaseUrl = process.env.DATABASE_URL

  if (!mainnetRpc) throw new Error('Missing: BASE_RPC_URL')
  if (!sepoliaRpc) throw new Error('Missing: BASE_SEPOLIA_RPC_URL')
  if (!mainnetContract) throw new Error('Missing: NTZS_CONTRACT_ADDRESS_BASE')
  if (!minterKey) throw new Error('Missing: MINTER_PRIVATE_KEY')
  if (!databaseUrl) throw new Error('Missing: DATABASE_URL')

  const mainnetProvider = new ethers.JsonRpcProvider(mainnetRpc)
  const sepoliaProvider = new ethers.JsonRpcProvider(sepoliaRpc)
  const minter = new ethers.Wallet(minterKey, mainnetProvider)

  const mainnetToken = new ethers.Contract(mainnetContract, TOKEN_ABI, minter)
  const sepoliaToken = new ethers.Contract(SEPOLIA_CONTRACT, TOKEN_ABI, sepoliaProvider)

  console.log('Mainnet Airdrop')
  console.log('Mainnet contract: ', mainnetContract)
  console.log('Sepolia snapshot: ', SEPOLIA_CONTRACT)
  console.log('Minter:           ', minter.address)
  console.log('Dry run:          ', DRY_RUN)
  console.log('')

  // Pull all known wallets on Base chain from DB
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()

  const { rows } = await client.query(`
    SELECT DISTINCT w.address, u.email
    FROM wallets w
    JOIN users u ON u.id = w.user_id
    WHERE w.chain = 'base'
      AND w.address NOT LIKE '0x_pending_%'
    ORDER BY u.email
  `)

  await client.end()

  console.log(`Checking ${rows.length} wallets against Sepolia snapshot...\n`)

  let minted = 0
  let skipped = 0
  let zeroed = 0
  let failed = 0
  let totalMintedTzs = 0

  for (const row of rows) {
    // Source of truth: current Sepolia balance
    const sepoliaBalance = await sepoliaToken.balanceOf(row.address)

    if (sepoliaBalance === 0n) {
      zeroed++
      continue
    }

    // Check if already funded on mainnet
    const mainnetBalance = await mainnetToken.balanceOf(row.address)

    if (mainnetBalance >= sepoliaBalance) {
      const bal = Number(ethers.formatUnits(mainnetBalance, 18))
      console.log(`SKIP  ${row.email} | ${row.address} | already has ${bal} TZS on mainnet`)
      skipped++
      continue
    }

    const toMint = sepoliaBalance - mainnetBalance
    const toMintTzs = Number(ethers.formatUnits(toMint, 18))

    if (DRY_RUN) {
      console.log(`DRY   ${row.email} | ${row.address} | would mint ${toMintTzs} TZS`)
      minted++
      totalMintedTzs += toMintTzs
      continue
    }

    try {
      const tx = await mainnetToken.mint(row.address, toMint)
      console.log(`MINT  ${row.email} | ${row.address} | ${toMintTzs} TZS | tx: ${tx.hash}`)
      await tx.wait(1)
      minted++
      totalMintedTzs += toMintTzs
    } catch (err) {
      console.error(`FAIL  ${row.email} | ${row.address} | ${err.message}`)
      failed++
    }
  }

  console.log('')
  console.log('--- Summary ---')
  console.log(`Minted:        ${minted} wallets (${totalMintedTzs.toLocaleString()} TZS)`)
  console.log(`Skipped:       ${skipped} wallets (already on mainnet)`)
  console.log(`Zero balance:  ${zeroed} wallets (nothing to migrate)`)
  console.log(`Failed:        ${failed} wallets`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
