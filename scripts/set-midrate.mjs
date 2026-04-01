#!/usr/bin/env node
/**
 * One-time script to set midRate=2610 in both lpFxConfig and lpFxPairs.
 * Usage: node scripts/set-midrate.mjs
 */
import 'dotenv/config'
import pg from 'pg'

const RATE = 2610

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  // Update lpFxConfig
  const r1 = await client.query(
    `INSERT INTO lp_fx_config (id, mid_rate_tzs, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET mid_rate_tzs = $1, updated_at = NOW()`,
    [RATE]
  )
  console.log(`lpFxConfig updated: midRateTZS = ${RATE}`)

  // Update all lpFxPairs
  const r2 = await client.query(
    `UPDATE lp_fx_pairs SET mid_rate = $1, updated_at = NOW()`,
    [String(RATE)]
  )
  console.log(`lpFxPairs updated: ${r2.rowCount} row(s) set to midRate = ${RATE}`)

  // Verify
  const { rows: pairs } = await client.query(`SELECT id, token1_symbol, token2_symbol, mid_rate, is_active FROM lp_fx_pairs`)
  console.log('\nCurrent pairs:')
  pairs.forEach(p => console.log(`  ${p.token1_symbol}/${p.token2_symbol} midRate=${p.mid_rate} active=${p.is_active}`))
} finally {
  await client.end()
}
