/**
 * Disbursement kill switch (guard G3) — ops toggle.
 *
 * Flips the `system_flags.disbursements_paused` row, which every payout path
 * checks before burning nTZS or calling the PSP. Takes effect immediately, no
 * redeploy. (The env var DISBURSEMENTS_PAUSED=1 is a separate hard override.)
 *
 * Usage:
 *   npx tsx scripts/toggle-disbursements.ts pause "reason shown to users"
 *   npx tsx scripts/toggle-disbursements.ts resume
 *   npx tsx scripts/toggle-disbursements.ts status
 */
import 'dotenv/config'
import { createDbClient } from '@ntzs/db'

async function main() {
  const cmd = process.argv[2]
  const note = process.argv.slice(3).join(' ').trim() || null

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const { sql } = createDbClient(url)

  try {
    if (cmd === 'pause' || cmd === 'resume') {
      const enabled = cmd === 'pause'
      await sql`
        insert into system_flags (key, enabled, note, updated_at)
        values ('disbursements_paused', ${enabled}, ${note}, now())
        on conflict (key) do update set enabled = ${enabled}, note = ${note}, updated_at = now()
      `
      console.log(`Disbursements ${enabled ? 'PAUSED' : 'RESUMED'}${note ? ` — ${note}` : ''}`)
    } else if (cmd === 'status') {
      const rows = await sql<{ enabled: boolean; note: string | null; updated_at: Date }[]>`
        select enabled, note, updated_at from system_flags where key = 'disbursements_paused' limit 1
      `
      console.log('env DISBURSEMENTS_PAUSED:', process.env.DISBURSEMENTS_PAUSED === '1' ? 'PAUSED (hard override)' : 'not set')
      console.log('system_flags row  :', rows[0] ?? '(none — not paused via DB)')
    } else {
      console.log('Usage: toggle-disbursements.ts <pause [note] | resume | status>')
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
