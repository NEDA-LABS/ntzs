import { describe, it, expect } from 'vitest'

import { grossUpWithdrawal, netPayoutTzs, SNIPPE_FLAT_FEE_TZS, WITHDRAWAL_FEE_PCT } from './payout-math'

describe('grossUpWithdrawal (explicit merchant/consumer withdrawal gross-up)', () => {
  it('covers net + flat fee + platform fee exactly (invariant)', () => {
    for (const net of [5000, 5321, 10_000, 123_456, 999_999]) {
      const { burnAmountTzs, platformFeeTzs } = grossUpWithdrawal(net)
      expect(burnAmountTzs).toBe(net + SNIPPE_FLAT_FEE_TZS + platformFeeTzs)
      expect(platformFeeTzs).toBeGreaterThanOrEqual(0)
    }
  })

  it('matches the consumer off-ramp formula for a 5,000 net withdrawal', () => {
    const { burnAmountTzs, platformFeeTzs } = grossUpWithdrawal(5000)
    expect(burnAmountTzs).toBe(Math.ceil(6500 / (1 - WITHDRAWAL_FEE_PCT / 100)))
    expect(burnAmountTzs).toBe(6533)
    expect(platformFeeTzs).toBe(33)
  })

  it('round-trips through netPayoutTzs: the recipient gets exactly the requested net', () => {
    for (const net of [5000, 25_000, 400_000]) {
      const { burnAmountTzs, platformFeeTzs } = grossUpWithdrawal(net)
      expect(netPayoutTzs({ amountTzs: burnAmountTzs, platformFeeTzs })).toBe(net)
    }
  })
})

describe('netPayoutTzs (what actually lands on the phone)', () => {
  it('backs fees out of grossed-up requests so the recipient gets the intended net', () => {
    // A legacy grossed-up request: burn 6,533 with 33 platform fee → 5,000 net.
    expect(netPayoutTzs({ amountTzs: 6533, platformFeeTzs: 33 })).toBe(6533 - 33 - SNIPPE_FLAT_FEE_TZS)
    expect(netPayoutTzs({ amountTzs: 6533, platformFeeTzs: 33 })).toBe(5000)
  })

  it('pays the full amount for requests without a platform fee', () => {
    expect(netPayoutTzs({ amountTzs: 8000, platformFeeTzs: null })).toBe(8000)
  })

  it('never returns a negative payout', () => {
    expect(netPayoutTzs({ amountTzs: 1000, platformFeeTzs: 100 })).toBe(0)
    expect(netPayoutTzs({ amountTzs: -5, platformFeeTzs: null })).toBe(0)
  })
})
