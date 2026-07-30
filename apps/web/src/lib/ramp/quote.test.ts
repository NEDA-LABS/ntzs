import { afterEach, describe, it, expect } from 'vitest'

import {
  DEFAULT_RAMP_FEE_PERCENT,
  PLATFORM_FEE_PCT,
  rampPlatformFeeTzs,
  rampSpendEnabled,
} from './quote'

/**
 * Ramp pricing carries two representations of one number: a FRACTION (0.005)
 * inherited from the original constant, and a PERCENT (0.5) which is what
 * `partners.fee_percent` stores and what every other product in the codebase
 * passes around. They differ by 100×.
 *
 * On a money path that is not a rounding difference — it is charging a partner
 * a hundred times too much, or waiving our margin entirely. These tests exist
 * so the two can never drift apart silently.
 */
describe('the fraction and the percent describe the same fee', () => {
  it('pins 0.005 and 0.5 to each other', () => {
    expect(DEFAULT_RAMP_FEE_PERCENT).toBe(0.5)
    expect(PLATFORM_FEE_PCT * 100).toBe(DEFAULT_RAMP_FEE_PERCENT)
  })

  it('charges the same as the old hard-coded arithmetic when no rate is set', () => {
    // The exact expression this replaced: Math.ceil(gross * PLATFORM_FEE_PCT).
    for (const gross of [5_000, 12_345, 100_000, 999_999, 2_500_000]) {
      expect(rampPlatformFeeTzs(gross)).toBe(Math.ceil(gross * PLATFORM_FEE_PCT))
    }
  })
})

describe('rampPlatformFeeTzs', () => {
  it('honours a negotiated rate', () => {
    // 0.25% of 100,000 = 250 — half the standard rate, not 100× it.
    expect(rampPlatformFeeTzs(100_000, 0.25)).toBe(250)
    expect(rampPlatformFeeTzs(100_000, 1)).toBe(1_000)
  })

  it('falls back to the standard rate rather than to zero', () => {
    // A partner row with no price must be billed normally. Treating a missing
    // rate as free would silently waive our margin on every ramp they run.
    const standard = rampPlatformFeeTzs(100_000)
    expect(standard).toBe(500)
    for (const bad of [undefined, null, 0, -1, NaN, Infinity]) {
      expect(rampPlatformFeeTzs(100_000, bad as number)).toBe(standard)
    }
  })

  it('rounds up, so the reserve is never short a shilling', () => {
    expect(rampPlatformFeeTzs(10_001)).toBe(51) // 50.005 → 51
  })
})

/**
 * Cross-border crypto → Tanzanian-merchant payment is a distinct regulatory
 * surface from the domestic spend rails, and has its own gate. If these two
 * ever collapse into one flag, enabling domestic bill-pay would silently open
 * an unapproved cross-border rail.
 */
describe('the ramp merchant gate is independent of the domestic spend gate', () => {
  const KEYS = ['RAMP_SPEND_ENABLED', 'SELCOM_SPEND_ENABLED', 'SELCOM_LIPA_ENABLED', 'SELCOM_BILLPAY_ENABLED'] as const
  const saved: Record<string, string | undefined> = {}
  for (const k of KEYS) saved[k] = process.env[k]

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('stays off when every domestic rail is on', () => {
    process.env.SELCOM_SPEND_ENABLED = 'true'
    process.env.SELCOM_LIPA_ENABLED = 'true'
    process.env.SELCOM_BILLPAY_ENABLED = 'true'
    delete process.env.RAMP_SPEND_ENABLED
    expect(rampSpendEnabled()).toBe(false)
  })

  it('requires the exact string true, so a typo fails closed', () => {
    for (const v of ['TRUE', 'True', '1', 'yes', 'false', '']) {
      process.env.RAMP_SPEND_ENABLED = v
      expect(rampSpendEnabled(), `RAMP_SPEND_ENABLED=${v} must not enable the rail`).toBe(false)
    }
    process.env.RAMP_SPEND_ENABLED = 'true'
    expect(rampSpendEnabled()).toBe(true)
  })
})
