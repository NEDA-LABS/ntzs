/**
 * recover-op-funds.ts
 *
 * One-off recovery script for a user who accidentally sent USDC on Optimism
 * to their nTZS-managed HD wallet address.
 *
 * Since all EVM chains share the same secp256k1 key pair, the same private key
 * that controls the address on Base also controls it on Optimism. We derive the
 * key on-demand from the partner's encrypted HD seed and sign a rescue transfer.
 *
 * Usage:
 *   npx tsx scripts/recover-op-funds.ts --address 0x...  --to 0x...
 *   npx tsx scripts/recover-op-funds.ts --address 0x...  --to 0x...  --execute
 *
 * --execute    Actually broadcast the transaction (default is dry-run)
 * --address    The affected wallet address on Optimism
 * --to         Destination address for the rescued USDC
 *              (recommended: the user's same address on Base, or a platform collect wallet)
 */

import 'dotenv/config'
import { eq, sql } from 'drizzle-orm'
import { ethers } from 'ethers'
import { getDb } from '../apps/web/src/lib/db'
import { wallets, users, partners, partnerUsers } from '@ntzs/db'
import { deriveWallet } from '../apps/web/src/lib/waas/hd-wallets'

// ── Optimism constants ─────────────────────────────────────────────────────────
const OP_RPC_URL = process.env.OPTIMISM_RPC_URL ?? 'https://mainnet.optimism.io'
const OP_USDC_ADDRESS = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'
const MIN_GAS_ETH = '0.00008' // ~$0.25 — enough for one ERC-20 transfer on OP

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]

// ── CLI args ───────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }
  const address = get('--address')
  const to = get('--to')
  const amountArg = get('--amount') // optional: USDC amount e.g. "10", omit for full balance
  const execute = args.includes('--execute')

  if (!address || !to) {
    console.error('Usage: npx tsx scripts/recover-op-funds.ts --address 0x... --to 0x... [--amount 10] [--execute]')
    process.exit(1)
  }

  // Normalise to EIP-55 checksum form so DB lookups match
  const checksumAddress = ethers.getAddress(address)
  return { address: checksumAddress, to, amount: amountArg ? parseFloat(amountArg) : null, execute }
}

async function main() {
  const { address, to, amount, execute } = parseArgs()

  console.log('\n=== Optimism USDC Recovery ===')
  console.log('Affected address :', address)
  console.log('Destination      :', to)
  console.log('Mode             :', execute ? '🔴 EXECUTE (live transaction)' : '🟡 DRY-RUN (no transaction)')
  console.log()

  const { db } = getDb()

  // ── 1. Look up the wallet record ──────────────────────────────────────────
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(sql`lower(${wallets.address}) = lower(${address})`)
    .limit(1)

  if (!wallet) {
    console.error(`❌ No wallet found in DB for address ${address}`)
    console.error('   Check the address is correct and belongs to a WaaS partner user.')
    process.exit(1)
  }

  console.log('Wallet record:')
  console.log('  ID            :', wallet.id)
  console.log('  Provider      :', wallet.provider)
  console.log('  Chain (stored):', wallet.chain)
  console.log('  Wallet index  :', wallet.providerWalletRef)

  // ── 2. Get the encrypted HD seed and wallet index ────────────────────────
  let encryptedSeed: string
  let walletIndex: number

  if (wallet.provider === 'partner_hd' && wallet.providerWalletRef) {
    // Happy path: wallet is correctly typed and index is on the wallet record
    walletIndex = Number(wallet.providerWalletRef)

    const [partnerRow] = await db
      .select({ name: partners.name, encryptedHdSeed: partners.encryptedHdSeed })
      .from(partnerUsers)
      .innerJoin(partners, eq(partners.id, partnerUsers.partnerId))
      .where(eq(partnerUsers.userId, wallet.userId))
      .limit(1)

    if (!partnerRow?.encryptedHdSeed) {
      console.error(`❌ Partner has no encryptedHdSeed configured.`)
      process.exit(1)
    }

    console.log('\nPartner:', partnerRow.name)
    encryptedSeed = partnerRow.encryptedHdSeed
  } else if (wallet.provider === 'platform_hd') {
    walletIndex = Number(wallet.providerWalletRef)
    const platformSeed = process.env.PLATFORM_HD_SEED
    if (!platformSeed) {
      console.error('❌ PLATFORM_HD_SEED env var is not set.')
      process.exit(1)
    }
    encryptedSeed = platformSeed
  } else {
    // Wallet stored as 'external' but may still be a partner HD wallet —
    // check partner_users for a walletIndex (happens when wallet was registered
    // via the WaaS API without explicitly setting the provider field).
    const [puRow] = await db
      .select({
        walletIndex: partnerUsers.walletIndex,
        partnerName: partners.name,
        encryptedHdSeed: partners.encryptedHdSeed,
      })
      .from(partnerUsers)
      .innerJoin(partners, eq(partners.id, partnerUsers.partnerId))
      .where(eq(partnerUsers.userId, wallet.userId))
      .limit(1)

    if (!puRow?.encryptedHdSeed || puRow.walletIndex == null) {
      console.error(`❌ Wallet provider is "${wallet.provider}" and no partner HD seed or wallet index found.`)
      console.error('   For CDP wallets, contact Coinbase CDP support.')
      process.exit(1)
    }

    walletIndex = puRow.walletIndex
    encryptedSeed = puRow.encryptedHdSeed
    console.log(`\nNote: wallet stored as "external" but found via partner_users`)
    console.log('Partner:', puRow.partnerName)
  }

  // ── 3. Derive the wallet and connect to Optimism ──────────────────────────
  const provider = new ethers.JsonRpcProvider(OP_RPC_URL)
  const signer = deriveWallet(encryptedSeed, walletIndex).connect(provider)

  if (signer.address.toLowerCase() !== address.toLowerCase()) {
    console.error(`❌ Derived address ${signer.address} does NOT match expected ${address}`)
    console.error('   walletIndex or encryptedSeed mismatch — aborting to prevent loss of funds.')
    process.exit(1)
  }

  console.log('\n✅ Key derivation verified — derived address matches on-chain address.')

  // ── 4. Check balances on Optimism ─────────────────────────────────────────
  const usdc = new ethers.Contract(OP_USDC_ADDRESS, ERC20_ABI, signer)
  const [usdcBalance, ethBalance, decimals] = await Promise.all([
    usdc.balanceOf(address) as Promise<bigint>,
    provider.getBalance(address),
    usdc.decimals() as Promise<number>,
  ])

  const usdcFormatted = ethers.formatUnits(usdcBalance, decimals)
  const ethFormatted = ethers.formatEther(ethBalance)

  console.log('\nBalances on Optimism:')
  console.log(`  USDC : ${usdcFormatted} USDC`)
  console.log(`  ETH  : ${ethFormatted} ETH (for gas)`)

  if (usdcBalance === 0n) {
    console.error('\n❌ No USDC balance found on Optimism for this address.')
    console.error('   Double-check the address and confirm the transaction has settled on Optimistic Etherscan.')
    process.exit(1)
  }

  const minGasWei = ethers.parseEther(MIN_GAS_ETH)
  if (ethBalance < minGasWei) {
    console.error(`\n❌ Insufficient ETH for gas on Optimism.`)
    console.error(`   Have : ${ethFormatted} ETH`)
    console.error(`   Need : ≥${MIN_GAS_ETH} ETH`)
    console.error()
    console.error('   Action required: Send a small amount of ETH on Optimism to:')
    console.error(`   ${address}`)
    console.error()
    console.error('   Options:')
    console.error('   1. Send from any exchange (Binance, Coinbase) with "Optimism" network selected')
    console.error('   2. Bridge from Base: https://superbridge.app')
    process.exit(1)
  }

  // Resolve the transfer amount: --amount flag or full balance
  let transferAmount: bigint
  if (amount !== null) {
    transferAmount = ethers.parseUnits(amount.toString(), decimals)
    if (transferAmount > usdcBalance) {
      console.error(`\n❌ Requested amount (${amount} USDC) exceeds balance (${usdcFormatted} USDC).`)
      process.exit(1)
    }
  } else {
    transferAmount = usdcBalance
  }
  const transferFormatted = ethers.formatUnits(transferAmount, decimals)

  if (!execute) {
    console.log('\n✅ Dry-run complete. All checks passed.')
    console.log(`   Would transfer ${transferFormatted} USDC from ${address} → ${to} on Optimism.`)
    if (amount !== null) {
      const remaining = ethers.formatUnits(usdcBalance - transferAmount, decimals)
      console.log(`   Remaining on Optimism after transfer: ${remaining} USDC`)
    }
    console.log('\n   Re-run with --execute to broadcast the transaction.')
    process.exit(0)
  }

  // ── 5. Execute the rescue transfer ────────────────────────────────────────
  console.log(`\nBroadcasting transfer of ${transferFormatted} USDC → ${to} ...`)

  const tx = await (usdc.transfer as (to: string, amount: bigint) => Promise<ethers.TransactionResponse>)(
    to,
    transferAmount
  )

  console.log(`  Tx hash: ${tx.hash}`)
  console.log('  Waiting for confirmation...')

  const receipt = await tx.wait()
  if (!receipt) throw new Error('Transaction receipt is null')

  const remainingBalance = usdcBalance - transferAmount
  console.log(`\n✅ Success! USDC rescued in block ${receipt.blockNumber}`)
  console.log(`   https://optimistic.etherscan.io/tx/${receipt.hash}`)
  if (remainingBalance > 0n) {
    console.log(`\n   Remaining on Optimism: ${ethers.formatUnits(remainingBalance, decimals)} USDC`)
    console.log('   Re-run without --amount to sweep the rest.')
  }
  console.log()
  console.log('Next steps:')
  console.log('  1. Verify balance landed at the destination address on Base.')
  console.log('  3. Update your partner integration docs to warn against sending on non-Base chains.')
}

main().catch((err) => {
  console.error('\n💥 Unhandled error:', err)
  process.exit(1)
})
