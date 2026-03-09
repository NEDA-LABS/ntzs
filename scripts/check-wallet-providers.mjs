/**
 * Check wallet providers to identify CDP vs HD-derived wallets
 */
import 'dotenv/config'
import pg from 'pg'

const { Client } = pg

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  console.log('Checking wallet providers...\n')

  const { rows } = await client.query(`
    SELECT 
      u.id,
      u.email,
      w.provider,
      w.address,
      pu.wallet_index
    FROM users u
    JOIN wallets w ON w.user_id = u.id AND w.chain = 'base'
    LEFT JOIN partner_users pu ON pu.user_id = u.id
    WHERE w.address NOT LIKE '0x_pending_%'
    ORDER BY w.created_at
  `)

  await client.end()

  const byProvider = {}
  
  for (const row of rows) {
    const provider = row.provider || 'unknown'
    if (!byProvider[provider]) byProvider[provider] = []
    byProvider[provider].push(row)
  }

  console.log('Wallets by provider:\n')
  for (const [provider, wallets] of Object.entries(byProvider)) {
    console.log(`${provider}: ${wallets.length} wallets`)
    if (provider === 'cdp') {
      console.log('  CDP wallets (cannot be signed with HD seed):')
      wallets.forEach(w => console.log(`    - ${w.email}: ${w.address}`))
    }
  }
}

main().catch(console.error)
