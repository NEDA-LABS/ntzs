/**
 * Diagnose wallet address mismatches between database and HD derivation.
 * 
 * Identifies users where:
 * - The wallet address in the database doesn't match the address derived from their wallet_index
 * - This causes transfer failures because the API derives a different address than what has funds
 * 
 * Run: node scripts/diagnose-wallet-mismatch.mjs
 */
import 'dotenv/config'
import pg from 'pg'
import { ethers } from 'ethers'
import crypto from 'crypto'

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
  const child = hdNode.deriveChild(walletIndex)
  return child.address
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
    ['function balanceOf(address) view returns (uint256)'],
    provider
  )

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  console.log('Checking for wallet address mismatches...\n')

  const { rows } = await client.query(`
    SELECT 
      u.id as user_id,
      u.email,
      pu.partner_id,
      pu.external_id,
      pu.wallet_index,
      w.id as wallet_id,
      w.address as db_address,
      p.encrypted_hd_seed,
      p.name as partner_name
    FROM users u
    JOIN partner_users pu ON pu.user_id = u.id
    JOIN wallets w ON w.user_id = u.id AND w.chain = 'base'
    JOIN partners p ON p.id = pu.partner_id
    WHERE w.address NOT LIKE '0x_pending_%'
      AND pu.wallet_index IS NOT NULL
      AND p.encrypted_hd_seed IS NOT NULL
    ORDER BY u.created_at ASC
  `)

  console.log(`Checking ${rows.length} users...\n`)

  const mismatches = []
  let checked = 0
  let matched = 0

  for (const row of rows) {
    checked++
    
    try {
      const derivedAddress = deriveAddress(row.encrypted_hd_seed, row.wallet_index)
      
      if (derivedAddress.toLowerCase() !== row.db_address.toLowerCase()) {
        // Check balances on both addresses
        const dbBalance = await token.balanceOf(row.db_address)
        const derivedBalance = await token.balanceOf(derivedAddress)
        
        const dbBalanceTzs = Number(dbBalance / BigInt(10) ** BigInt(18))
        const derivedBalanceTzs = Number(derivedBalance / BigInt(10) ** BigInt(18))
        
        mismatches.push({
          userId: row.user_id,
          email: row.email,
          partnerId: row.partner_id,
          partnerName: row.partner_name,
          externalId: row.external_id,
          walletIndex: row.wallet_index,
          walletId: row.wallet_id,
          dbAddress: row.db_address,
          derivedAddress: derivedAddress,
          dbBalanceTzs,
          derivedBalanceTzs,
        })
        
        console.log(`❌ MISMATCH: ${row.email}`)
        console.log(`   User ID: ${row.user_id}`)
        console.log(`   Partner: ${row.partner_name}`)
        console.log(`   Wallet Index: ${row.wallet_index}`)
        console.log(`   DB Address:      ${row.db_address} (${dbBalanceTzs} TZS)`)
        console.log(`   Derived Address: ${derivedAddress} (${derivedBalanceTzs} TZS)`)
        if (dbBalanceTzs > 0) {
          console.log(`   ⚠️  FUNDS IN OLD ADDRESS - Migration needed!`)
        }
        console.log('')
      } else {
        matched++
      }
    } catch (err) {
      console.error(`⚠️  Error checking ${row.email}: ${err.message}`)
    }
  }

  await client.end()

  console.log('\n' + '='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))
  console.log(`Total users checked: ${checked}`)
  console.log(`Matched: ${matched}`)
  console.log(`Mismatches: ${mismatches.length}`)
  
  if (mismatches.length > 0) {
    console.log('\n⚠️  CRITICAL: Found wallet address mismatches!')
    console.log('These users will fail transfers because the API derives a different address.')
    
    const withFunds = mismatches.filter(m => m.dbBalanceTzs > 0)
    if (withFunds.length > 0) {
      console.log(`\n${withFunds.length} users have funds in their old addresses:`)
      withFunds.forEach(m => {
        console.log(`  - ${m.email}: ${m.dbBalanceTzs} TZS in ${m.dbAddress}`)
      })
    }
    
    console.log('\nNext steps:')
    console.log('1. Run: node scripts/fix-wallet-mismatch.mjs (updates DB addresses)')
    console.log('2. Run: node scripts/migrate-wallet-funds.mjs (migrates funds to new addresses)')
  } else {
    console.log('\n✅ All wallet addresses match their derived addresses.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
