/**
 * Admin transfer: mint to destination + burn from source.
 * Use when source wallet is a CDP embedded wallet (no extractable private key).
 * Net on-chain supply is unchanged.
 *
 * Usage:
 *   node scripts/admin-transfer-ntzs.mjs \
 *     --from 0xE95c39e9A252f5BFC912d12fCC37Fc09f1510C63 \
 *     --to   0x3FCB8C79f32bBfFBaAbc14C69a755562FacEBb84 \
 *     --amount 2000
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import { ethers } from 'ethers'
import readline from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true })

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx !== -1 ? process.argv[idx + 1] : null
}

const FROM_ADDRESS = arg('from') ?? '0xE95c39e9A252f5BFC912d12fCC37Fc09f1510C63'
const TO_ADDRESS   = arg('to')   ?? '0x3FCB8C79f32bBfFBaAbc14C69a755562FacEBb84'
const AMOUNT       = parseFloat(arg('amount') ?? '2000')

const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function mint(address to, uint256 amount)',
  'function burn(address from, uint256 amount)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
]

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

async function main() {
  const rpcUrl          = process.env.BASE_RPC_URL
  const minterKey       = process.env.MINTER_PRIVATE_KEY
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE ?? '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'

  if (!rpcUrl)    throw new Error('BASE_RPC_URL is not set')
  if (!minterKey) throw new Error('MINTER_PRIVATE_KEY is not set')
  if (!ethers.isAddress(FROM_ADDRESS)) throw new Error(`Invalid from address: ${FROM_ADDRESS}`)
  if (!ethers.isAddress(TO_ADDRESS))   throw new Error(`Invalid to address: ${TO_ADDRESS}`)

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const signer   = new ethers.Wallet(minterKey, provider)
  const token    = new ethers.Contract(contractAddress, TOKEN_ABI, signer)

  console.log('--- Admin nTZS Transfer (mint-to-dest + burn-from-source) ---')
  console.log(`From    : ${FROM_ADDRESS}`)
  console.log(`To      : ${TO_ADDRESS}`)
  console.log(`Amount  : ${AMOUNT} nTZS`)
  console.log(`Contract: ${contractAddress}`)
  console.log(`Signer  : ${signer.address}`)
  console.log('')

  // ── Verify roles ────────────────────────────────────────────────────────────
  const [minterRole, burnerRole] = await Promise.all([
    token.MINTER_ROLE(),
    token.BURNER_ROLE(),
  ])
  const [hasMinter, hasBurner] = await Promise.all([
    token.hasRole(minterRole, signer.address),
    token.hasRole(burnerRole, signer.address),
  ])

  if (!hasMinter) throw new Error(`Signer ${signer.address} does not have MINTER_ROLE`)
  if (!hasBurner) throw new Error(`Signer ${signer.address} does not have BURNER_ROLE`)

  console.log('Roles OK: MINTER_ROLE + BURNER_ROLE confirmed')

  // ── Check source balance ────────────────────────────────────────────────────
  const fromBalanceWei = await token.balanceOf(FROM_ADDRESS)
  const fromBalanceTzs = Number(ethers.formatUnits(fromBalanceWei, 18))
  const amountWei      = ethers.parseUnits(AMOUNT.toString(), 18)

  console.log(`Source balance: ${fromBalanceTzs} nTZS`)

  if (fromBalanceWei < amountWei) {
    throw new Error(`Insufficient balance: source has ${fromBalanceTzs} nTZS, need ${AMOUNT}`)
  }

  const toBalanceBefore = await token.balanceOf(TO_ADDRESS)
  console.log(`Dest balance (before): ${Number(ethers.formatUnits(toBalanceBefore, 18))} nTZS`)
  console.log('')

  // ── Confirm ─────────────────────────────────────────────────────────────────
  const answer = await prompt(`Type "yes" to proceed with admin transfer of ${AMOUNT} nTZS: `)
  if (answer.toLowerCase() !== 'yes') {
    console.log('Aborted.')
    process.exit(0)
  }

  // ── Step 1: Mint to destination ─────────────────────────────────────────────
  console.log(`\nStep 1/2: Minting ${AMOUNT} nTZS to ${TO_ADDRESS}...`)
  const mintTx = await token.mint(TO_ADDRESS, amountWei)
  console.log(`  Tx submitted: ${mintTx.hash}`)
  process.stdout.write('  Waiting for confirmation...')
  const mintReceipt = await mintTx.wait(1)
  console.log(' confirmed.')
  console.log(`  Block: ${mintReceipt.blockNumber}`)

  // ── Step 2: Burn from source ────────────────────────────────────────────────
  console.log(`\nStep 2/2: Burning ${AMOUNT} nTZS from ${FROM_ADDRESS}...`)
  const burnTx = await token.burn(FROM_ADDRESS, amountWei)
  console.log(`  Tx submitted: ${burnTx.hash}`)
  process.stdout.write('  Waiting for confirmation...')
  const burnReceipt = await burnTx.wait(1)
  console.log(' confirmed.')
  console.log(`  Block: ${burnReceipt.blockNumber}`)

  // ── Summary ─────────────────────────────────────────────────────────────────
  const [newFrom, newTo] = await Promise.all([
    token.balanceOf(FROM_ADDRESS),
    token.balanceOf(TO_ADDRESS),
  ])

  console.log('')
  console.log('=== Transfer Complete ===')
  console.log(`Source ${FROM_ADDRESS}: ${Number(ethers.formatUnits(newFrom, 18))} nTZS`)
  console.log(`Dest   ${TO_ADDRESS}: ${Number(ethers.formatUnits(newTo, 18))} nTZS`)
  console.log('')
  console.log(`Mint tx : https://basescan.org/tx/${mintReceipt.hash}`)
  console.log(`Burn tx : https://basescan.org/tx/${burnReceipt.hash}`)
}

main().catch(err => {
  console.error('\nError:', err.message)
  process.exit(1)
})
