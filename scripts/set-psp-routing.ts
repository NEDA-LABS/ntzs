/**
 * PSP routing — ops flip tool (plan D3).
 *
 * Sets which provider handles a money-flow capability. Takes effect within
 * ~30s (facade routing cache TTL), no deploy. Routing is consulted only at
 * transaction creation; in-flight records complete via their stamped provider,
 * so a flip (or rollback) never affects money already moving.
 *
 * Usage:
 *   npx tsx scripts/set-psp-routing.ts status
 *   npx tsx scripts/set-psp-routing.ts set <capability> <provider> [note]
 *   npx tsx scripts/set-psp-routing.ts rules <capability> '<json>' [note]
 *   npx tsx scripts/set-psp-routing.ts clear-rules <capability>
 *
 * Capabilities: collections_mobile | collections_card | payouts_mobile | payouts_bank
 * Providers:    snippe | azampay | selcom
 * Rules examples:
 *   payout amount bands: '[{"maxAmountTzs":150000,"provider":"azampay"},{"provider":"selcom"}]'
 *   collections pilot:   '{"pilotUserIds":["<uuid>"],"pilotProvider":"selcom"}'
 */
import 'dotenv/config'
import { createDbClient } from '@ntzs/db'

const CAPABILITIES = ['collections_mobile', 'collections_card', 'payouts_mobile', 'payouts_bank']
const PROVIDERS = ['snippe', 'azampay', 'selcom']

async function main() {
  const [cmd, capability, value, ...noteParts] = process.argv.slice(2)
  const note = noteParts.join(' ').trim() || null

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const { sql } = createDbClient(url)

  try {
    if (cmd === 'status' || !cmd) {
      const rows = await sql`select capability, provider, rules, note, updated_at from psp_routing order by capability`
      console.table(rows.map((r) => ({ ...r, rules: r.rules ? JSON.stringify(r.rules) : null })))
      return
    }

    if (!capability || !CAPABILITIES.includes(capability)) {
      throw new Error(`capability must be one of: ${CAPABILITIES.join(', ')}`)
    }

    if (cmd === 'set') {
      if (!value || !PROVIDERS.includes(value)) throw new Error(`provider must be one of: ${PROVIDERS.join(', ')}`)
      await sql`
        insert into psp_routing (capability, provider, note, updated_at)
        values (${capability}, ${value}, ${note}, now())
        on conflict (capability) do update set provider = ${value}, note = ${note}, updated_at = now()
      `
      console.log(`✅ ${capability} → ${value}${note ? ` — ${note}` : ''} (live within ~30s)`)
    } else if (cmd === 'rules') {
      if (!value) throw new Error('rules JSON required')
      const parsed = JSON.parse(value) // validate before writing
      await sql`
        update psp_routing set rules = ${JSON.stringify(parsed)}::jsonb, note = coalesce(${note}, note), updated_at = now()
        where capability = ${capability}
      `
      console.log(`✅ ${capability} rules set:`, JSON.stringify(parsed))
    } else if (cmd === 'clear-rules') {
      await sql`update psp_routing set rules = null, updated_at = now() where capability = ${capability}`
      console.log(`✅ ${capability} rules cleared — base provider applies`)
    } else {
      console.log('Usage: set-psp-routing.ts <status | set <cap> <provider> [note] | rules <cap> <json> [note] | clear-rules <cap>>')
      process.exitCode = 1
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
