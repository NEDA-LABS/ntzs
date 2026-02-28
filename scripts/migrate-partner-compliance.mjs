import 'dotenv/config'
import pg from 'pg'

const { Client } = pg

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  try {
    console.log('Adding partner compliance columns...')

    await client.query(`
      ALTER TABLE "partners"
        ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone,
        ADD COLUMN IF NOT EXISTS "suspend_reason" text,
        ADD COLUMN IF NOT EXISTS "daily_limit_tzs" bigint,
        ADD COLUMN IF NOT EXISTS "contract_signed_at" timestamp with time zone;
    `)

    console.log('Done. Partner compliance columns added.')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
