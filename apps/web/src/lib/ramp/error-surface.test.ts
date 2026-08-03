import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

const API = path.join(__dirname, '../../app/api')

/**
 * A live partner integrating the ramp reported "a 500 status code on the
 * merchant payments" — and that was the WHOLE report, because a bare 500
 * carries nothing: not which precondition failed, not whether money moved,
 * not anything to quote to support. These pins keep every ramp surface
 * answering with a coded, correlatable error instead.
 */
describe('ramp routes never answer with a bare 500', () => {
  it('balance distinguishes "not provisioned yet" from a transient failure', () => {
    const src = fs.readFileSync(path.join(API, 'v1/ramp/balance/route.ts'), 'utf8')
    // The FIRST call a new partner makes returns their funding address — an
    // onboarding gap here must say so, not 500.
    expect(src).toContain('ramp_not_provisioned')
    expect(src).toContain('ramp_unavailable')
  })

  it('the money routes catch residual throws with a requestId', () => {
    for (const rel of ['v1/ramp/quote/route.ts', 'v1/ramp/offramp/route.ts', 'v1/ramp/onramp/route.ts']) {
      const src = fs.readFileSync(path.join(API, rel), 'utf8')
      expect(src, `${rel} must convert residual throws`).toContain('ramp_unavailable')
      expect(src, `${rel} must give the partner something to quote to support`).toContain('requestId')
    }
  })

  it('the settlement engine cannot strand a row on a pre-swap failure', () => {
    const src = fs.readFileSync(path.join(__dirname, 'offramp.ts'), 'utf8')
    // RPC float read is guarded — an RPC hiccup fails the row cleanly.
    expect(src).toContain('Could not read the USDC float (RPC)')
    // Seed decryption happens INSIDE the guarded swap region: a decrypt
    // failure must mark the settlement failed, not leave it in 'swapping'.
    const swappingAt = src.indexOf("{ status: 'swapping' }")
    const tryAt = src.indexOf('try {', swappingAt)
    const signerAt = src.indexOf('getSettlementSigner(', swappingAt)
    expect(swappingAt).toBeGreaterThan(-1)
    expect(tryAt).toBeGreaterThan(swappingAt)
    expect(signerAt).toBeGreaterThan(tryAt)
  })

  it('the readiness probe exists and never prints env values', () => {
    const src = fs.readFileSync(path.join(API, 'admin/ramp-readiness/route.ts'), 'utf8')
    expect(src).toContain("requireAnyRole(['super_admin'])")
    // Presence booleans only: the probe reports Boolean(...) of secrets and
    // must never interpolate the env value itself.
    expect(src).toContain('Boolean(process.env.SOLVER_PRIVATE_KEY)')
    expect(src).not.toMatch(/\$\{process\.env\.SOLVER_PRIVATE_KEY\}/)
  })

  /**
   * 3 Aug 2026: the probe said READY for a week while every live quote 500'd
   * on ramp_quotes.destination missing in production (hand-applied migration
   * 0065 skipped). READY must mean the WRITE PATH works, not just that the
   * components exist.
   */
  it('the readiness probe exercises the real quote write path — and never persists', () => {
    const src = fs.readFileSync(path.join(API, 'admin/ramp-readiness/route.ts'), 'utf8')
    // A real INSERT into ramp_quotes…
    expect(src).toContain('.insert(rampQuotes)')
    // …inside a transaction aborted by a sentinel, so nothing ever commits.
    expect(src).toContain('.transaction(')
    expect(src).toContain('DryRunRollback')
    expect(src).toContain('throw new DryRunRollback')
  })

  it('the readiness probe checks for unapplied hand-run migrations by name', () => {
    const src = fs.readFileSync(path.join(API, 'admin/ramp-readiness/route.ts'), 'utf8')
    expect(src).toContain('information_schema.columns')
    // The exact columns the ramp money path writes — quote insert AND
    // execute-side settlement row.
    expect(src).toContain("colPresent('ramp_quotes', 'destination')")
    expect(src).toContain("colPresent('ramp_settlements', 'destination')")
    expect(src).toContain("colPresent('sandbox_limit_events', 'subject_ref')")
  })

  it('the readiness probe flags a stale FX mid instead of pricing against a dead number', () => {
    const src = fs.readFileSync(path.join(API, 'admin/ramp-readiness/route.ts'), 'utf8')
    expect(src).toContain('pairAgeHours')
    // Two thresholds: nagging warning (>48h), hard blocker (>120h).
    expect(src).toContain('pairAgeHours > 48')
    expect(src).toContain('pairAgeHours > 120')
  })
})
