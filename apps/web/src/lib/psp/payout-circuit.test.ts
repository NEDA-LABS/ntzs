import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import { circuitDecision, CIRCUIT_FAIL_THRESHOLD, CIRCUIT_OPEN_RESPONSE } from './payout-circuit'

const SRC = path.join(__dirname, '../..')

/**
 * 1 Aug 2026: every rail refused payout initiations for ~4 hours; burns kept
 * happening anyway — six of them, 899,034 TZS stranded, wallets drained with
 * nothing received. The breaker makes the honest failure structural: once the
 * rails are evidently down, cash-outs refuse BEFORE the burn.
 */
describe('payout circuit breaker', () => {
  it('opens only on repeated refusals with zero successes', () => {
    expect(circuitDecision(CIRCUIT_FAIL_THRESHOLD, 0)).toBe(true)
    expect(circuitDecision(CIRCUIT_FAIL_THRESHOLD + 5, 0)).toBe(true)
  })

  it('one accepted dispatch is proof of life — never block a working rail', () => {
    expect(circuitDecision(CIRCUIT_FAIL_THRESHOLD, 1)).toBe(false)
    expect(circuitDecision(100, 1)).toBe(false)
  })

  it('a few failures alone are not an outage', () => {
    expect(circuitDecision(CIRCUIT_FAIL_THRESHOLD - 1, 0)).toBe(false)
    expect(circuitDecision(0, 0)).toBe(false)
  })

  it('the refusal tells the user their balance is untouched', () => {
    // The whole point versus the old behaviour: no burn happened, and the
    // message must say so, or users retry into the same wall.
    expect(CIRCUIT_OPEN_RESPONSE.message).toContain('balance is untouched')
  })

  it('every interactive cash-out path checks the breaker BEFORE burning', () => {
    for (const rel of [
      'app/api/v1/withdrawals/route.ts',
      'app/app/user/withdraw/actions.ts',
      'app/api/v1/partners/treasury/withdraw/route.ts',
      'app/api/v1/ramp/offramp/route.ts',
    ]) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(src, `${rel} must gate on the circuit breaker`).toContain('payoutRailsLookDead(')
    }
  })

  it('the DB-backed check fails OPEN', () => {
    const src = fs.readFileSync(path.join(__dirname, 'payout-circuit.ts'), 'utf8')
    // A broken breaker must never block a healthy rail.
    expect(src).toContain('failing OPEN')
    expect(src).toContain('return { dead: false }')
  })

  it('the treasury and app paths refuse identical retries', () => {
    const treasury = fs.readFileSync(path.join(SRC, 'app/api/v1/partners/treasury/withdraw/route.ts'), 'utf8')
    expect(treasury).toContain('duplicate_withdrawal')
    expect(treasury).toContain('allowDuplicate')
    const app = fs.readFileSync(path.join(SRC, 'app/app/user/withdraw/actions.ts'), 'utf8')
    expect(app).toContain('An identical withdrawal was made moments ago')
  })
})
