/**
 * Admin Reserve Burn — one-time supply correction script
 *
 * Fetches live Snippe balance + on-chain nTZS supply, computes the exact
 * surplus, then burns it from the specified wallet to restore 1:1 backing.
 * NO Snippe payout is triggered — this is a pure supply correction burn.
 *
 * Usage:
 *   node --env-file=apps/web/.env.local scripts/admin-reserve-burn.mjs
 *
 * Requires in env:
 *   MINTER_PRIVATE_KEY           — wallet with BURNER_ROLE
 *   BASE_RPC_URL                 — Base mainnet RPC
 *   SNIPPE_API_KEY               — Snippe API key
 *   NTZS_CONTRACT_ADDRESS_BASE   — nTZS contract on Base
 */

import { createRequire } from 'module'
import { config } from 'dotenv'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Try loading env from multiple locations
for (const p of [
  resolve(__dirname, '../apps/web/.env.local'),
  resolve(__dirname, '../apps/web/.env'),
  resolve(__dirname, '../.env.local'),
]) {
  if (existsSync(p)) { config({ path: p }); break }
}

const require = createRequire(import.meta.url)
const { ethers } = require(resolve(__dirname, '../node_modules/ethers'))

// ── Config ────────────────────────────────────────────────────────────────────

const BURNER_KEY            = process.env.MINTER_PRIVATE_KEY
const RPC_URL               = process.env.BASE_RPC_URL
const SNIPPE_API_KEY        = process.env.SNIPPE_API_KEY
const CONTRACT_ADDRESS      = process.env.NTZS_CONTRACT_ADDRESS_BASE || '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
const TARGET_WALLET         = '0xE95c39e9A252f5BFC912d12fCC37Fc09f1510C63'
const SNIPPE_BASE_URL       = 'https://api.snippe.sh'

const NTZS_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function burn(address from, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return n.toLocaleString('en-US') + ' TZS'
}

async function getSnippeBalance() {
  const resp = await fetch(`${SNIPPE_BASE_URL}/v1/payments/balance`, {
    headers: { Authorization: `Bearer ${SNIPPE_API_KEY}` },
  })
  const json = await resp.json()
  if (json.status !== 'success' || !json.data) {
    throw new Error(`Snippe balance error: ${json.message ?? JSON.stringify(json)}`)
  }
  const raw = json.data.available
  return typeof raw === 'object' ? Number(raw.value) : Number(raw)
}

function toTzs(wei) {
  return Number(wei / 10n ** 18n)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Validate env
  if (!BURNER_KEY)       throw new Error('MINTER_PRIVATE_KEY not set')
  if (!RPC_URL)          throw new Error('BASE_RPC_URL not set')
  if (!SNIPPE_API_KEY)   throw new Error('SNIPPE_API_KEY not set')

  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const signer   = new ethers.Wallet(BURNER_KEY, provider)
  const token    = new ethers.Contract(CONTRACT_ADDRESS, NTZS_ABI, signer)

  console.log('\n=== Pre-burn State ===')

  // Fetch live numbers in parallel
  const [snippeAvailable, totalSupplyWei, walletBalanceWei] = await Promise.all([
    getSnippeBalance(),
    token.totalSupply(),
    token.balanceOf(TARGET_WALLET),
  ])

  const onChainSupply   = toTzs(totalSupplyWei)
  const walletBalance   = toTzs(walletBalanceWei)
  const burnAmountTzs   = onChainSupply - snippeAvailable

  console.log(`  Snippe available:  ${fmt(snippeAvailable)}`)
  console.log(`  On-chain supply:   ${fmt(onChainSupply)}`)
  console.log(`  Target wallet bal: ${fmt(walletBalance)}`)
  console.log(`  Surplus to burn:   ${fmt(burnAmountTzs)}`)
  console.log(`  Reserve health:    ${((snippeAvailable / onChainSupply) * 100).toFixed(1)}%`)

  if (burnAmountTzs <= 0) {
    console.log('\nNo surplus — reserve is already at 100% or above. Exiting.')
    process.exit(0)
  }

  if (walletBalance < burnAmountTzs) {
    throw new Error(
      `Wallet only has ${fmt(walletBalance)} but need to burn ${fmt(burnAmountTzs)}`
    )
  }

  // Verify BURNER_ROLE
  const burnerRole = await token.BURNER_ROLE()
  const hasBurner  = await token.hasRole(burnerRole, await signer.getAddress())
  if (!hasBurner) {
    throw new Error(`Signer ${await signer.getAddress()} does not have BURNER_ROLE`)
  }

  console.log(`\n  Signer:     ${await signer.getAddress()}`)
  console.log(`  Contract:   ${CONTRACT_ADDRESS}`)
  console.log(`  From:       ${TARGET_WALLET}`)
  console.log(`  Burn:       ${fmt(burnAmountTzs)}`)
  console.log('\n  Sending burn transaction...')

  const amountWei = BigInt(burnAmountTzs) * 10n ** 18n
  const tx = await token.burn(TARGET_WALLET, amountWei)

  console.log(`  Tx hash:    ${tx.hash}`)
  console.log('  Waiting for confirmation...')

  await tx.wait(1)
  console.log('  Confirmed.')

  // Post-burn verification
  const [newSupplyWei, newWalletWei] = await Promise.all([
    token.totalSupply(),
    token.balanceOf(TARGET_WALLET),
  ])

  const newSupply = toTzs(newSupplyWei)
  const newWallet = toTzs(newWalletWei)

  console.log('\n=== Post-burn State ===')
  console.log(`  On-chain supply:   ${fmt(newSupply)}`)
  console.log(`  Snippe balance:    ${fmt(snippeAvailable)}`)
  console.log(`  Wallet balance:    ${fmt(newWallet)}`)
  console.log(`  Reserve health:    ${((snippeAvailable / newSupply) * 100).toFixed(1)}%`)
  console.log(`  Tx:                https://basescan.org/tx/${tx.hash}`)
  console.log('\nDone.')
}

main().catch(err => {
  console.error('\nFATAL:', err.message)
  process.exit(1)
})
