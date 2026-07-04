import { describe, it, expect } from 'vitest'

import { netPayoutTzs, SNIPPE_FLAT_FEE_TZS } from './payout-math'

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
