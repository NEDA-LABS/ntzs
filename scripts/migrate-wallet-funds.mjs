/**
 * Migrate funds from old wallet addresses to new derived addresses.
 * 
 * This script:
 * 1. Finds users with funds in their old (incorrect) wallet addresses
 * 2. Uses the partner's HD seed to sign transfers from old to new addresses
 * 3. Transfers all nTZS tokens to the correct derived address
 * 
 * IMPORTANT: Run fix-wallet-mismatch.mjs FIRST to update database addresses.
 * 
 * Run: node scripts/migrate-wallet-funds.mjs
 */
import 'dotenv/config'
import pg from 'pg'
import { ethers } from 'ethers'
import crypto from 'crypto'
import readline from 'readline'

const { Client } = pg
const DERIVATION_BASE = "m/44'/8453'/0'/0"
const ALGORITHM = 'aes-256-gcm'

function decryptSeed(encryptedSeed) {
  const key = Buffer.from(process.env.WAAS_ENCRYPTION_KEY, 'hex')
  const parts = encryptedSeed.split(':')
  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const encrypted = Buffer.from(parts[2], 'hex')
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  
  let decrypted = decipher.update(encrypted, undefined, 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function deriveWallet(encryptedSeed, walletIndex) {
  const mnemonic = decryptSeed(encryptedSeed)
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, DERIVATION_BASE)
  return hdNode.deriveChild(walletIndex)
}

async function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.toLowerCase() === 'yes')
    })
  })
}

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.NTZS_CONTRACT_ADDRESS_BASE
  
  if (!rpcUrl || !contractAddress) {
    throw new Error('RPC_URL and CONTRACT_ADDRESS required')
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const token = new ethers.Contract(
    contractAddress,
    ['function transfer(address to, uint256 amount) returns (bool)'],
    provider
  )

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  console.log('Finding users with funds to migrate...\n')

  // This query finds users where the DB address was ALREADY updated to the derived address
  // but we need to find the OLD address by re-deriving and checking if it has a different balance
  const { rows } = await client.query(`
    SELECT 
      u.id, u.email,
      pu.wallet_index,
      w.address as current_address,
      p.encrypted_hd_seed
    FROM users u
    JOIN partner_users pu ON pu.user_id = u.id
    JOIN wallets w ON w.user_id = u.id AND w.chain = 'base'
    JOIN partners p ON p.id = pu.partner_id
    WHERE w.address NOT LIKE '0x_pending_%'
      AND pu.wallet_index IS NOT NULL
  `)

  // For this script to work, we need to know the OLD addresses
  // Since we don't have them in DB anymore, we need to pass them as arguments
  // OR we need to run this BEFORE fix-wallet-mismatch.mjs
  
  console.log('⚠️  IMPORTANT: This script should be run BEFORE fix-wallet-mismatch.mjs')
  console.log('Or you need to provide the old addresses manually.\n')
  
  // For now, let's create a manual migration function
  console.log('Manual migration mode:')
  console.log('Provide old and new addresses to migrate funds.\n')
  
  const oldAddress = await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question('Old address (with funds): ', answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
  
  const newAddress = await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question('New address (derived): ', answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
  
  const userId = await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question('User ID: ', answer => {
      rl.close()
      resolve(answer.trim())
    })
  })

  // Get user's wallet index and partner seed
  const [user] = await client.query(`
    SELECT 
      u.email,
      pu.wallet_index,
      p.encrypted_hd_seed
    FROM users u
    JOIN partner_users pu ON pu.user_id = u.id
    JOIN partners p ON p.id = pu.partner_id
    WHERE u.id = $1
  `, [userId]).then(r => r.rows)

  if (!user) {
    console.error('User not found')
    await client.end()
    return
  }

  await client.end()

  // Check balances
  const oldBalance = await token.balanceOf(oldAddress)
  const newBalance = await token.balanceOf(newAddress)
  
  const oldBalanceTzs = Number(oldBalance / BigInt(10) ** BigInt(18))
  const newBalanceTzs = Number(newBalance / BigInt(10) ** BigInt(18))
  
  console.log(`\n${user.email}`)
  console.log(`Old address: ${oldAddress} (${oldBalanceTzs} TZS)`)
  console.log(`New address: ${newAddress} (${newBalanceTzs} TZS)`)
  
  if (oldBalanceTzs === 0) {
    console.log('\n✅ No funds to migrate!')
    return
  }
  
  console.log(`\nWill transfer ${oldBalanceTzs} TZS from old to new address.`)
  const proceed = await confirm('Type "yes" to proceed: ')
  
  if (!proceed) {
    console.log('Aborted.')
    return
  }

  // Derive wallet from index to sign the transfer
  const wallet = deriveWallet(user.encrypted_hd_seed, user.wallet_index).connect(provider)
  
  // Verify the derived wallet matches the old address
  if (wallet.address.toLowerCase() !== oldAddress.toLowerCase()) {
    console.error(`\n❌ ERROR: Derived wallet ${wallet.address} doesn't match old address ${oldAddress}`)
    console.error('Cannot sign the transfer. The old address may not be HD-derived.')
    return
  }

  // Check wallet has ETH for gas
  const ethBalance = await provider.getBalance(wallet.address)
  if (ethBalance === BigInt(0)) {
    console.error('\n❌ ERROR: Old wallet has no ETH for gas')
    console.error('Fund it with ETH first, then re-run this script.')
    return
  }

  console.log(`\nSigning transfer from ${oldAddress}...`)
  
  const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)'])
  
  const tx = await wallet.sendTransaction({
    to: contractAddress,
    data: iface.encodeFunctionData('transfer', [newAddress, oldBalance]),
  })

  console.log(`Transaction sent: ${tx.hash}`)
  console.log('Waiting for confirmation...')
  
  const receipt = await tx.wait()
  
  if (!receipt) {
    console.error('Transaction receipt is null')
    return
  }

  console.log(`\n✅ Migration complete!`)
  console.log(`Transaction: ${receipt.hash}`)
  console.log(`${oldBalanceTzs} TZS transferred from ${oldAddress} to ${newAddress}`)
}

main().catch(console.error)
