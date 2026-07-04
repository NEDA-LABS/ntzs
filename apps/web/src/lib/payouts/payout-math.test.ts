import { describe, it, expect } from 'vitest'

import { grossUpSettlement, netPayoutTzs, MIN_SETTLEMENT_TZS, SNIPPE_FLAT_FEE_TZS, PLATFORM_FEE_PCT } from './payout-math'

describe('grossUpSettlement (merchant auto-settlement gross-up)', () => {
  it('covers net + flat fee + platform fee exactly (invariant)', () => {
    for (const batch of [MIN_SETTLEMENT_TZS, 5321, 10_000, 123_456, 1_000_000]) {
      const { burnAmountTzs, platformFeeTzs } = grossUpSettlement(batch)
      expect(burnAmountTzs).toBe(batch + SNIPPE_FLAT_FEE_TZS + platformFeeTzs)
      expect(platformFeeTzs).toBeGreaterThanOrEqual(0)
    }
  })

  it('grosses up the 5,000 TZS threshold batch to 6,533 (0.5% + 1,500 flat)', () => {
    const { burnAmountTzs, platformFeeTzs } = grossUpSettlement(5000)
    expect(burnAmountTzs).toBe(Math.ceil(6500 / (1 - PLATFORM_FEE_PCT)))
    expect(burnAmountTzs).toBe(6533)
    expect(platformFeeTzs).toBe(33)
  })

  it('never under-collects: the platform fee is at least pct of the net+flat base', () => {
    for (const batch of [5000, 7777, 50_000]) {
      const { burnAmountTzs } = grossUpSettlement(batch)
      expect(burnAmountTzs * (1 - PLATFORM_FEE_PCT)).toBeGreaterThanOrEqual(batch + SNIPPE_FLAT_FEE_TZS)
    }
  })
})

describe('netPayoutTzs (what actually lands on the phone)', () => {
  it('backs fees out of grossed-up requests so the recipient gets the original batch', () => {
    const { burnAmountTzs, platformFeeTzs } = grossUpSettlement(5000)
    expect(netPayoutTzs({ amountTzs: burnAmountTzs, platformFeeTzs })).toBe(5000)
  })

  it('pays the full amount for legacy requests without a platform fee', () => {
    expect(netPayoutTzs({ amountTzs: 8000, platformFeeTzs: null })).toBe(8000)
  })

  it('never returns a negative payout', () => {
    expect(netPayoutTzs({ amountTzs: 1000, platformFeeTzs: 100 })).toBe(0)
    expect(netPayoutTzs({ amountTzs: -5, platformFeeTzs: null })).toBe(0)
  })
})
