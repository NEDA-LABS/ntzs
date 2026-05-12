/**
 * bridge-op-usdc-to-base.ts
 *
 * Bridges USDC from Optimism → Base using Circle's CCTP (Cross-Chain Transfer Protocol).
 * CCTP burns USDC on the source chain and mints native USDC on the destination chain —
 * no wrapped tokens, no liquidity pools, no 7-day withdrawal window.
 *
 * Flow:
 *   1. Approve USDC on Optimism (spender = CCTP TokenMessenger)
 *   2. Call depositForBurn → burns USDC on Optimism, emits MessageSent
 *   3. Poll Circle's attestation API until the burn is attested (~20s)
 *   4. Call receiveMessage on Base with the attestation → mints USDC on Base
 *
 * Usage:
 *   npx tsx scripts/bridge-op-usdc-to-base.ts --amount 10 [--execute]
 *   npx tsx scripts/bridge-op-usdc-to-base.ts            [--execute]  (full balance)
 */

import 'dotenv/config'
import { eq, sql } from 'drizzle-orm'
import { ethers } from 'ethers'
import { getDb } from '../apps/web/src/lib/db'
import { wallets, partners, partnerUsers } from '@ntzs/db'
import { deriveWallet } from '../apps/web/src/lib/waas/hd-wallets'

// ── Chain config ───────────────────────────────────────────────────────────────
const SOURCE_ADDRESS  = '0x2c8026a595cf91b33854F221e3004B03828100f8'

const OP = {
  rpc:              process.env.OPTIMISM_RPC_URL ?? 'https://mainnet.optimism.io',
  usdc:             '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  tokenMessenger:   '0x2B4069517957735bE00ceE0fadAE88a26365528f',
  domain:           2,
}

const BASE = {
  rpc:              process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
  msgTransmitter:   '0xAD09780d193884d503182aD4588450C416D6F9D4',
  domain:           6,
}

const ATTESTATION_API = 'https://iris-api.circle.com/attestations'

// ── ABIs (minimal) ─────────────────────────────────────────────────────────────
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]

const TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)',
  'event MessageSent(bytes message)',
]

const MSG_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function addressToBytes32(address: string): string {
  return '0x' + address.replace('0x', '').toLowerCase().padStart(64, '0')
}

async function pollAttestation(messageHash: string, maxMinutes = 30): Promise<string> {
  const url = `${ATTESTATION_API}/${messageHash}`
  const attempts = maxMinutes * 4 // check every 15 seconds
  process.stdout.write(`Waiting for Circle attestation (up to ${maxMinutes} min)`)
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, 15_000))
    process.stdout.write('.')
    try {
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json() as { status: string; attestation: string }
        if (data.status === 'complete') {
          process.stdout.write(' ✅\n')
          return data.attestation
        }
      }
    } catch { /* network hiccup, keep trying */ }
  }
  throw new Error(`Attestation timed out after ${maxMinutes} minutes`)
}

// ── CLI args ───────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined }
  const amountArg = get('--amount')
  const execute = args.includes('--execute')
  return { amount: amountArg ? parseFloat(amountArg) : null, execute }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const { amount, execute } = parseArgs()

  console.log('\n=== CCTP Bridge: Optimism → Base ===')
  console.log('From (Optimism) :', SOURCE_ADDRESS)
  console.log('To   (Base)     :', SOURCE_ADDRESS)
  console.log('Amount          :', amount !== null ? `${amount} USDC` : 'full balance')
  console.log('Mode            :', execute ? '🔴 EXECUTE (live transaction)' : '🟡 DRY-RUN')
  console.log()

  // ── 1. Derive wallet ───────────────────────────────────────────────────────
  const { db } = getDb()

  const [wallet] = await db
    .select()
    .from(wallets)
    .where(sql`lower(${wallets.address}) = lower(${SOURCE_ADDRESS})`)
    .limit(1)

  if (!wallet) { console.error('❌ Wallet not found in DB'); process.exit(1) }

  const [puRow] = await db
    .select({ walletIndex: partnerUsers.walletIndex, encryptedHdSeed: partners.encryptedHdSeed, partnerName: partners.name })
    .from(partnerUsers)
    .innerJoin(partners, eq(partners.id, partnerUsers.partnerId))
    .where(eq(partnerUsers.userId, wallet.userId))
    .limit(1)

  if (!puRow?.encryptedHdSeed || puRow.walletIndex == null) {
    console.error('❌ Could not find partner HD seed or wallet index'); process.exit(1)
  }

  console.log('Partner         :', puRow.partnerName)

  const opProvider   = new ethers.JsonRpcProvider(OP.rpc)
  const baseProvider = new ethers.JsonRpcProvider(BASE.rpc)
  const signer       = deriveWallet(puRow.encryptedHdSeed, puRow.walletIndex).connect(opProvider)

  if (signer.address.toLowerCase() !== SOURCE_ADDRESS.toLowerCase()) {
    console.error('❌ Derived address mismatch — aborting'); process.exit(1)
  }
  console.log('✅ Key derivation verified\n')

  // ── 2. Check balances ──────────────────────────────────────────────────────
  const usdc = new ethers.Contract(OP.usdc, ERC20_ABI, signer)
  const [usdcBalance, ethBalance, decimals] = await Promise.all([
    usdc.balanceOf(SOURCE_ADDRESS) as Promise<bigint>,
    opProvider.getBalance(SOURCE_ADDRESS),
    usdc.decimals() as Promise<number>,
  ])

  console.log('Balances on Optimism:')
  console.log(`  USDC : ${ethers.formatUnits(usdcBalance, decimals)} USDC`)
  console.log(`  ETH  : ${ethers.formatEther(ethBalance)} ETH (gas)`)

  if (usdcBalance === 0n) { console.error('\n❌ No USDC on Optimism'); process.exit(1) }
  if (ethBalance < ethers.parseEther('0.00008')) {
    console.error('\n❌ Insufficient ETH for gas on Optimism'); process.exit(1)
  }

  const transferAmount = amount !== null
    ? ethers.parseUnits(amount.toString(), decimals)
    : usdcBalance

  if (transferAmount > usdcBalance) {
    console.error(`\n❌ Requested ${amount} USDC exceeds balance ${ethers.formatUnits(usdcBalance, decimals)} USDC`)
    process.exit(1)
  }

  console.log(`\nWill bridge     : ${ethers.formatUnits(transferAmount, decimals)} USDC`)
  console.log(`Remaining after : ${ethers.formatUnits(usdcBalance - transferAmount, decimals)} USDC`)

  if (!execute) {
    console.log('\n✅ Dry-run complete — re-run with --execute to bridge.')
    process.exit(0)
  }

  // ── 3. Approve TokenMessenger ──────────────────────────────────────────────
  console.log('\n[1/4] Approving CCTP TokenMessenger to spend USDC on Optimism...')
  const approveTx = await (usdc.approve as (spender: string, amount: bigint) => Promise<ethers.TransactionResponse>)(
    OP.tokenMessenger, transferAmount
  )
  await approveTx.wait()
  console.log(`      ✅ Approved  https://optimistic.etherscan.io/tx/${approveTx.hash}`)

  // ── 4. depositForBurn ──────────────────────────────────────────────────────
  console.log('\n[2/4] Burning USDC on Optimism via CCTP depositForBurn...')
  const tokenMessenger = new ethers.Contract(OP.tokenMessenger, TOKEN_MESSENGER_ABI, signer)
  const mintRecipientBytes32 = addressToBytes32(SOURCE_ADDRESS)

  const burnTx = await (tokenMessenger.depositForBurn as (
    amount: bigint, destinationDomain: number, mintRecipient: string, burnToken: string
  ) => Promise<ethers.TransactionResponse>)(
    transferAmount, BASE.domain, mintRecipientBytes32, OP.usdc
  )
  const burnReceipt = await burnTx.wait()
  if (!burnReceipt) throw new Error('Burn receipt is null')

  console.log(`      ✅ Burned   https://optimistic.etherscan.io/tx/${burnTx.hash}`)

  // Extract MessageSent event to get the raw message bytes
  const messengerIface = new ethers.Interface(TOKEN_MESSENGER_ABI)
  let messageBytes: string | undefined
  for (const log of burnReceipt.logs) {
    try {
      const parsed = messengerIface.parseLog({ topics: [...log.topics], data: log.data })
      if (parsed?.name === 'MessageSent') {
        messageBytes = parsed.args[0] as string
        break
      }
    } catch { /* not this log */ }
  }
  if (!messageBytes) throw new Error('MessageSent event not found in burn receipt')

  const messageHash = ethers.keccak256(messageBytes)
  console.log(`      Message hash: ${messageHash}`)

  // ── 5. Wait for Circle attestation ────────────────────────────────────────
  console.log('\n[3/4]', { messageHash })
  const attestation = await pollAttestation(messageHash, 30)
  console.log(`      ✅ Attested`)

  // ── 6. receiveMessage on Base ──────────────────────────────────────────────
  console.log('\n[4/4] Minting USDC on Base via receiveMessage...')

  // Need ETH on Base for this tx — use a funded relayer if available
  const baseSigner = (() => {
    const relayerKey = process.env.RELAYER_PRIVATE_KEY ?? process.env.MINTER_PRIVATE_KEY
    if (relayerKey) return new ethers.Wallet(relayerKey, baseProvider)
    // Fall back to the same derived wallet connected to Base
    return deriveWallet(puRow.encryptedHdSeed, puRow.walletIndex).connect(baseProvider)
  })()

  const msgTransmitter = new ethers.Contract(BASE.msgTransmitter, MSG_TRANSMITTER_ABI, baseSigner)
  const mintTx = await (msgTransmitter.receiveMessage as (
    message: string, attestation: string
  ) => Promise<ethers.TransactionResponse>)(messageBytes, attestation)
  const mintReceipt = await mintTx.wait()
  if (!mintReceipt) throw new Error('Mint receipt is null')

  console.log(`      ✅ Minted    https://basescan.org/tx/${mintTx.hash}`)

  console.log(`\n🎉 Bridge complete!`)
  console.log(`   ${ethers.formatUnits(transferAmount, decimals)} USDC is now at ${SOURCE_ADDRESS} on Base.`)
  if (usdcBalance - transferAmount > 0n) {
    console.log(`   Remaining on Optimism: ${ethers.formatUnits(usdcBalance - transferAmount, decimals)} USDC`)
    console.log(`   Re-run without --amount to bridge the rest.`)
  }
}

main().catch(err => { console.error('\n💥', err.message ?? err); process.exit(1) })
