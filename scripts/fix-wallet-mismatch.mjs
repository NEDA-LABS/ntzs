/**
 * Fix wallet address mismatches by updating the database to use derived addresses.
 * 
 * WARNING: This will update wallet addresses in the database.
 * Run diagnose-wallet-mismatch.mjs first to see what will change.
 * 
 * Run: node scripts/fix-wallet-mismatch.mjs
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

function deriveAddress(encryptedSeed, walletIndex) {
  const mnemonic = decryptSeed(encryptedSeed)
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, DERIVATION_BASE)
  return hdNode.deriveChild(walletIndex).address
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
  const token = new ethers.Contract(contractAddress, ['function balanceOf(address) view returns (uint256)'], provider)

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const { rows } = await client.query(`
    SELECT 
      u.id, u.email,
      pu.wallet_index,
      w.id as wallet_id,
      w.address as db_address,
      p.encrypted_hd_seed
    FROM users u
    JOIN partner_users pu ON pu.user_id = u.id
    JOIN wallets w ON w.user_id = u.id AND w.chain = 'base'
    JOIN partners p ON p.id = pu.partner_id
    WHERE w.address NOT LIKE '0x_pending_%'
      AND pu.wallet_index IS NOT NULL
  `)

  const mismatches = []
  
  for (const row of rows) {
    const derivedAddress = deriveAddress(row.encrypted_hd_seed, row.wallet_index)
    
    if (derivedAddress.toLowerCase() !== row.db_address.toLowerCase()) {
      const dbBalance = await token.balanceOf(row.db_address)
      const derivedBalance = await token.balanceOf(derivedAddress)
      
      mismatches.push({
        ...row,
        derivedAddress,
        dbBalance: Number(dbBalance / BigInt(10) ** BigInt(18)),
        derivedBalance: Number(derivedBalance / BigInt(10) ** BigInt(18))
      })
    }
  }

  if (mismatches.length === 0) {
    console.log('✅ No mismatches found!')
    await client.end()
    return
  }

  console.log(`Found ${mismatches.length} mismatches:\n`)
  
  for (const m of mismatches) {
    console.log(`${m.email} (${m.id})`)
    console.log(`  DB Address:      ${m.db_address} (${m.dbBalance} TZS)`)
    console.log(`  Derived Address: ${m.derivedAddress} (${m.derivedBalance} TZS)`)
    console.log('')
  }

  console.log('⚠️  WARNING: This will update wallet addresses in the database.')
  console.log('Users with funds in the OLD address will need manual fund migration.\n')
  
  const proceed = await confirm('Type "yes" to proceed with the fix: ')
  
  if (!proceed) {
    console.log('Aborted.')
    await client.end()
    return
  }

  console.log('\nUpdating wallet addresses...\n')
  
  let updated = 0
  const needsMigration = []
  
  for (const m of mismatches) {
    await client.query(
      'UPDATE wallets SET address = $1, updated_at = NOW() WHERE id = $2',
      [m.derivedAddress, m.wallet_id]
    )
    
    updated++
    console.log(`✓ Updated ${m.email}`)
    
    if (m.dbBalance > 0 && m.derivedBalance === 0) {
      needsMigration.push(m)
      console.log(`  ⚠️  User has ${m.dbBalance} TZS in old address ${m.db_address}`)
    }
  }

  await client.end()
  
  console.log(`\n✅ Updated ${updated} wallet addresses!`)
  
  if (needsMigration.length > 0) {
    console.log(`\n⚠️  ${needsMigration.length} users need fund migration:`)
    needsMigration.forEach(m => {
      console.log(`  - ${m.email}: ${m.dbBalance} TZS in ${m.db_address}`)
    })
    console.log('\nRun: node scripts/migrate-wallet-funds.mjs to migrate funds')
  }
}

main().catch(console.error)
