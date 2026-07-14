/**
 * Pre-flight check for the abuse-guards migration (guard G4).
 *
 * READ-ONLY. The migration adds two unique indexes on burn_requests:
 *   - burn_requests_payout_reference_uq  (payout_reference)
 *   - burn_requests_user_idempotency_uq  (user_id, idempotency_key)
 *
 * Creating a unique index fails if existing rows already violate it. This script
 * reports any offending rows so they can be reconciled BEFORE the migration is
 * applied. It performs no writes.
 *
 * Usage: npx tsx scripts/preflight-burn-unique-indexes.ts
 */
import 'dotenv/config'
import { createDbClient } from '@ntzs/db'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const { sql } = createDbClient(url)

  try {
    const dupRefs = await sql<{ payout_reference: string; n: number; ids: string[] }[]>`
      select payout_reference, count(*)::int as n, array_agg(id) as ids
      from burn_requests
      where payout_reference is not null
      group by payout_reference
      having count(*) > 1
      order by n desc
    `
    const dupIdem = await sql<{ user_id: string; idempotency_key: string; n: number }[]>`
      select user_id, idempotency_key, count(*)::int as n
      from burn_requests
      where idempotency_key is not null
      group by user_id, idempotency_key
      having count(*) > 1
    `

    console.log(`Duplicate payout_reference groups: ${dupRefs.length}`)
    for (const r of dupRefs) console.log('  ', r.payout_reference, `x${r.n}`, r.ids)
    console.log(`Duplicate (user_id, idempotency_key) groups: ${dupIdem.length}`)
    for (const r of dupIdem) console.log('  ', r.user_id, r.idempotency_key, `x${r.n}`)

    if (dupRefs.length === 0 && dupIdem.length === 0) {
      console.log('\n✅ No conflicts — safe to apply the burn_requests unique indexes.')
    } else {
      console.log('\n⚠ Resolve the duplicates above before applying the migration.')
      process.exitCode = 2
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
