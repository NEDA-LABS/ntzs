#!/usr/bin/env node

import 'dotenv/config'
import pg from 'pg'

const { Client } = pg

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set')
  process.exit(1)
}

const client = new Client({ connectionString: DATABASE_URL })
await client.connect()

console.log('🔍 Detecting legacy shared users across partners...\n')

// Find users that are mapped to multiple partners
const result = await client.query(`
  SELECT 
    pu.user_id,
    u.email as user_email,
    u.name as user_name,
    COUNT(DISTINCT pu.partner_id) as partner_count,
    ARRAY_AGG(DISTINCT pu.partner_id) as partner_ids,
    ARRAY_AGG(DISTINCT p.name) as partner_names
  FROM partner_users pu
  INNER JOIN users u ON u.id = pu.user_id
  INNER JOIN partners p ON p.id = pu.partner_id
  GROUP BY pu.user_id, u.email, u.name
  HAVING COUNT(DISTINCT pu.partner_id) > 1
`)

const sharedUsers = result.rows

if (sharedUsers.length === 0) {
  console.log('✅ No legacy shared users found. All users are already partner-isolated.')
  process.exit(0)
}

console.log(`⚠️  Found ${sharedUsers.length} users shared across multiple partners:\n`)

for (const user of sharedUsers) {
  console.log(`User: ${user.user_email} (${user.user_name || 'no name'})`)
  console.log(`  User ID: ${user.user_id}`)
  console.log(`  Shared across ${user.partner_count} partners:`)
  
  const partnerIds = user.partner_ids
  const partnerNames = user.partner_names
  
  for (let i = 0; i < partnerIds.length; i++) {
    console.log(`    - ${partnerNames[i]} (${partnerIds[i]})`)
  }
  
  // Check wallet
  const walletResult = await client.query(
    'SELECT address, chain FROM wallets WHERE user_id = $1 LIMIT 1',
    [user.user_id]
  )
  
  if (walletResult.rows[0]) {
    const wallet = walletResult.rows[0]
    console.log(`  Wallet: ${wallet.address} (${wallet.chain})`)
  }
  
  console.log('')
}

console.log('\n📋 Recommended actions:\n')
console.log('For testing with friends:')
console.log('  - Leave these shared users as-is (legacy behavior)')
console.log('  - New users created after migration will be partner-isolated')
console.log('  - Existing shared users can continue using their wallets normally\n')

console.log('For production cleanup (optional):')
console.log('  1. Clone each shared user into separate partner-scoped user records')
console.log('  2. Create new wallets for each cloned user')
console.log('  3. Optionally migrate balances from shared wallet to new wallets')
console.log('  4. Update partner_users mappings to point to new user records\n')

console.log('💡 Since you\'re going live Friday with just friends testing,')
console.log('   the safest approach is to leave existing users alone and let')
console.log('   the new isolation logic handle all future signups.\n')

await client.end()
