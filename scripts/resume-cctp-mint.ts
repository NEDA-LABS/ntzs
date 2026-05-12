/**
 * resume-cctp-mint.ts
 *
 * Resumes a CCTP bridge where the burn on Optimism succeeded but the
 * Circle attestation timed out before we could mint on Base.
 *
 * Reads the MessageSent event from the burn tx, polls until Circle attests,
 * then calls receiveMessage on Base to complete the mint.
 *
 * Usage:
 *   npx tsx scripts/resume-cctp-mint.ts --burn-tx 0x...
 */

import 'dotenv/config'
import { ethers } from 'ethers'
import { deriveWallet } from '../apps/web/src/lib/waas/hd-wallets'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../apps/web/src/lib/db'
import { wallets, partners, partnerUsers } from '@ntzs/db'

const OP_RPC   = process.env.OPTIMISM_RPC_URL ?? 'https://mainnet.optimism.io'
const BASE_RPC = process.env.BASE_RPC_URL     ?? 'https://mainnet.base.org'

const BASE_MSG_TRANSMITTER = '0xAD09780d193884d503182aD4588450C416D6F9D4'
const ATTESTATION_API      = 'https://iris-api.circle.com/attestations'
const SOURCE_ADDRESS       = '0x2c8026a595cf91b33854F221e3004B03828100f8'

const MSG_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
  'function usedNonces(bytes32 sourceAndNonce) view returns (uint256)',
]

async function pollAttestation(messageHash: string, maxMinutes = 30): Promise<string> {
  const url = `${ATTESTATION_API}/${messageHash}`
  const attempts = maxMinutes * 4 // check every 15 seconds
  process.stdout.write(`Polling Circle attestation API (up to ${maxMinutes} min)`)

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
  throw new Error(`Attestation not available after ${maxMinutes} minutes`)
}

async function main() {
  const args = process.argv.slice(2)
  const burnTxIdx = args.indexOf('--burn-tx')
  const burnTxHash = burnTxIdx !== -1 ? args[burnTxIdx + 1] : undefined

  if (!burnTxHash) {
    console.error('Usage: npx tsx scripts/resume-cctp-mint.ts --burn-tx 0x...')
    process.exit(1)
  }

  console.log('\n=== Resume CCTP Mint on Base ===')
  console.log('Burn tx (Optimism):', burnTxHash)
  console.log('Recipient (Base)  :', SOURCE_ADDRESS)
  console.log()

  // ── 1. Fetch the MessageSent event from the burn tx ───────────────────────
  const opProvider = new ethers.JsonRpcProvider(OP_RPC)
  const receipt    = await opProvider.getTransactionReceipt(burnTxHash)
  if (!receipt) { console.error('❌ Could not fetch burn tx receipt'); process.exit(1) }

  const messengerIface = new ethers.Interface(['event MessageSent(bytes message)'])
  let messageBytes: string | undefined

  for (const log of receipt.logs) {
    try {
      const parsed = messengerIface.parseLog({ topics: [...log.topics], data: log.data })
      if (parsed?.name === 'MessageSent') {
        messageBytes = parsed.args[0] as string
        break
      }
    } catch { /* not this log */ }
  }

  if (!messageBytes) { console.error('❌ MessageSent event not found in burn tx'); process.exit(1) }

  const messageHash = ethers.keccak256(messageBytes)
  console.log('Message hash:', messageHash)

  // ── 2. Poll for Circle attestation ────────────────────────────────────────
  const attestation = await pollAttestation(messageHash)

  // ── 3. Check if already minted (idempotent) ───────────────────────────────
  const baseProvider = new ethers.JsonRpcProvider(BASE_RPC)
  const msgTransmitter = new ethers.Contract(BASE_MSG_TRANSMITTER, MSG_TRANSMITTER_ABI, baseProvider)

  // ── 4. Derive wallet / pick signer for Base gas ───────────────────────────
  const { db } = getDb()
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(sql`lower(${wallets.address}) = lower(${SOURCE_ADDRESS})`)
    .limit(1)

  if (!wallet) { console.error('❌ Wallet not found in DB'); process.exit(1) }

  const [puRow] = await db
    .select({ walletIndex: partnerUsers.walletIndex, encryptedHdSeed: partners.encryptedHdSeed })
    .from(partnerUsers)
    .innerJoin(partners, eq(partners.id, partnerUsers.partnerId))
    .where(eq(partnerUsers.userId, wallet.userId))
    .limit(1)

  if (!puRow?.encryptedHdSeed || puRow.walletIndex == null) {
    console.error('❌ Could not find partner HD seed'); process.exit(1)
  }

  // Prefer a funded relayer for the Base mint tx; fall back to user wallet
  const baseSigner = (() => {
    const relayerKey = process.env.RELAYER_PRIVATE_KEY ?? process.env.MINTER_PRIVATE_KEY
    if (relayerKey) {
      console.log('Using relayer wallet for Base gas')
      return new ethers.Wallet(relayerKey, baseProvider)
    }
    console.log('Using user wallet for Base gas (needs ETH on Base)')
    return deriveWallet(puRow.encryptedHdSeed, puRow.walletIndex).connect(baseProvider)
  })()

  const baseEth = await baseProvider.getBalance(baseSigner.address)
  console.log(`Signer (${baseSigner.address}) Base ETH: ${ethers.formatEther(baseEth)}`)
  if (baseEth < ethers.parseEther('0.00005')) {
    console.error('❌ Signer has insufficient ETH on Base for gas')
    process.exit(1)
  }

  // ── 5. receiveMessage on Base ─────────────────────────────────────────────
  console.log('\nMinting USDC on Base...')
  const mintTx = await (msgTransmitter.connect(baseSigner) as ethers.Contract)
    .receiveMessage(messageBytes, attestation) as ethers.TransactionResponse
  const mintReceipt = await mintTx.wait()
  if (!mintReceipt) throw new Error('Mint receipt null')

  console.log(`✅ Minted!  https://basescan.org/tx/${mintTx.hash}`)
  console.log(`\n🎉 USDC is now at ${SOURCE_ADDRESS} on Base.`)
}

main().catch(err => { console.error('\n💥', err.message ?? err); process.exit(1) })
