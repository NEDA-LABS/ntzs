import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { getDb } from '../apps/web/src/lib/db'

async function main() {
  const { db } = getDb()

  const rows = await db.execute(
    sql`SELECT u.id as user_id, u.email, u.name,
               pu.partner_id, pu.external_id, pu.wallet_index,
               p.name as partner_name,
               p.encrypted_hd_seed IS NOT NULL as partner_has_seed,
               w.address, w.chain, w.provider, w.provider_wallet_ref
        FROM wallets w
        JOIN users u ON u.id = w.user_id
        LEFT JOIN partner_users pu ON pu.user_id = u.id
        LEFT JOIN partners p ON p.id = pu.partner_id
        WHERE lower(w.address) = lower('0x2c8026a595cf91b33854F221e3004B03828100f8')`
  )
  console.log(JSON.stringify(rows, null, 2))
}
main().catch(console.error)
