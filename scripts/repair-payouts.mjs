/**
 * Repair script for burn requests that were burned on-chain but never had
 * a Snippe payout triggered, or requests stuck in 'approved' status.
 *
 * Usage:
 *   node --env-file=.env.local scripts/repair-payouts.mjs
 *
 * What it does:
 *   1. Finds burn_requests with status='burned' and payout_status IS NULL
 *      → triggers Snippe payout for each
 *   2. Finds burn_requests with status='approved'
 *      → reports them (manual backstage execution still required for those)
 */

import postgres from 'postgres'

const SNIPPE_BASE_URL = 'https://api.snippe.sh'
const SNIPPE_API_KEY = process.env.SNIPPE_API_KEY
const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''

if (!SNIPPE_API_KEY) {
  console.error('ERROR: SNIPPE_API_KEY not set')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL)

// ── 1. Fix burned requests with no payout ───────────────────────────────────
const burned = await sql`
  SELECT id, amount_tzs, recipient_phone, tx_hash
  FROM burn_requests
  WHERE status = 'burned'
    AND payout_status IS NULL
    AND recipient_phone IS NOT NULL
  ORDER BY created_at ASC
`

console.log(`\nFound ${burned.length} burned request(s) with no payout:\n`)

for (const row of burned) {
  console.log(`  ID: ${row.id}`)
  console.log(`  Amount: ${row.amount_tzs} TZS`)
  console.log(`  Phone: ${row.recipient_phone}`)
  console.log(`  Tx: ${row.tx_hash}`)

  const webhookUrl = `${APP_URL}/api/webhooks/snippe/payout`

  const body = {
    amount: Number(row.amount_tzs),
    channel: 'mobile',
    recipient_phone: row.recipient_phone,
    recipient_name: 'nTZS User',
    narration: 'nTZS withdrawal (repair)',
    ...(webhookUrl.startsWith('https://') ? { webhook_url: webhookUrl } : {}),
    metadata: { burn_request_id: row.id },
  }

  console.log(`  Sending payout...`)

  try {
    const resp = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SNIPPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const result = await resp.json()
    console.log(`  Snippe response:`, JSON.stringify(result))

    if (result.status === 'success' && result.data?.reference) {
      await sql`
        UPDATE burn_requests
        SET payout_reference = ${result.data.reference},
            payout_status = 'pending',
            updated_at = NOW()
        WHERE id = ${row.id}
      `
      console.log(`  ✓ Payout initiated — reference: ${result.data.reference}\n`)
    } else {
      await sql`
        UPDATE burn_requests
        SET payout_status = 'failed',
            payout_error = ${result.message ?? 'Unknown error'},
            updated_at = NOW()
        WHERE id = ${row.id}
      `
      console.error(`  ✗ Payout failed: ${result.message}\n`)
    }
  } catch (err) {
    console.error(`  ✗ Network error: ${err.message}\n`)
  }
}

// ── 2. Report approved (unexecuted) requests ─────────────────────────────────
const approved = await sql`
  SELECT id, amount_tzs, recipient_phone, created_at
  FROM burn_requests
  WHERE status = 'approved'
  ORDER BY created_at ASC
`

if (approved.length > 0) {
  console.log(`\nFound ${approved.length} approved request(s) pending execution:`)
  for (const row of approved) {
    console.log(`  ID: ${row.id} | ${row.amount_tzs} TZS → ${row.recipient_phone} | created: ${row.created_at}`)
  }
  console.log(`\n  → Go to /backstage/burns and click "Execute Burn" for each.\n`)
  console.log(`  NOTE: After today's fix, new user withdrawals execute inline and won't get stuck here.\n`)
} else {
  console.log('\nNo approved requests pending execution.\n')
}

await sql.end()
