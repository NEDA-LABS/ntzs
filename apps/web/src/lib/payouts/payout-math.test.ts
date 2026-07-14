import { describe, it, expect } from 'vitest'

import { grossUpWithdrawal, netPayoutTzs, getPayoutFeeTzs, SNIPPE_FLAT_FEE_TZS, WITHDRAWAL_FEE_PCT } from './payout-math'

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

  it('uses the stamped PSP fee when present, Snippe flat fee when absent', () => {
    // Same gross, different stamped fees → different nets.
    expect(netPayoutTzs({ amountTzs: 10_000, platformFeeTzs: 0, pspFeeTzs: 300 })).toBe(9_700)
    expect(netPayoutTzs({ amountTzs: 10_000, platformFeeTzs: 0, pspFeeTzs: null })).toBe(10_000 - SNIPPE_FLAT_FEE_TZS)
    expect(netPayoutTzs({ amountTzs: 10_000, platformFeeTzs: 0 })).toBe(10_000 - SNIPPE_FLAT_FEE_TZS)
  })
})

describe('getPayoutFeeTzs (per-provider fee model)', () => {
  it('snippe: flat fee regardless of amount', () => {
    expect(getPayoutFeeTzs('snippe', 5_000)).toBe(1500)
    expect(getPayoutFeeTzs('snippe', 1_000_000)).toBe(1500)
  })

  it('legacy/unknown tags fall back to the Snippe flat fee', () => {
    expect(getPayoutFeeTzs(null, 50_000)).toBe(1500)
    expect(getPayoutFeeTzs(undefined, 50_000)).toBe(1500)
    expect(getPayoutFeeTzs('snippe_card', 50_000)).toBe(1500)
  })

  it('azampay: 1% of the receive amount, rounded up', () => {
    expect(getPayoutFeeTzs('azampay', 5_000)).toBe(50)
    expect(getPayoutFeeTzs('azampay', 5_001)).toBe(51) // ceil
    expect(getPayoutFeeTzs('azampay', 1_000_000)).toBe(10_000)
  })

  it('selcom: published tariff tiers, including the cliff boundaries', () => {
    // Values from the Selcom Business Charges table (Jul 2026).
    expect(getPayoutFeeTzs('selcom', 100)).toBe(10)
    expect(getPayoutFeeTzs('selcom', 999)).toBe(10)
    expect(getPayoutFeeTzs('selcom', 1_000)).toBe(30)
    expect(getPayoutFeeTzs('selcom', 4_999)).toBe(60)
    expect(getPayoutFeeTzs('selcom', 5_000)).toBe(150) // cliff: 60 → 150
    expect(getPayoutFeeTzs('selcom', 10_000)).toBe(300)
    expect(getPayoutFeeTzs('selcom', 50_000)).toBe(550)
    expect(getPayoutFeeTzs('selcom', 50_001)).toBe(950) // cliff: 550 → 950
    expect(getPayoutFeeTzs('selcom', 100_000)).toBe(1_000)
    expect(getPayoutFeeTzs('selcom', 1_000_000)).toBe(1_900)
    expect(getPayoutFeeTzs('selcom', 5_000_000)).toBe(1_900)
    expect(getPayoutFeeTzs('selcom', 200_000_000)).toBe(10_000)
    expect(getPayoutFeeTzs('selcom', 999_999_999)).toBe(10_000) // beyond table → top tier
  })

  it('gross-up invariant holds for every provider fee', () => {
    for (const provider of ['snippe', 'azampay', 'selcom']) {
      for (const net of [5_000, 25_000, 400_000]) {
        const fee = getPayoutFeeTzs(provider, net)
        const { burnAmountTzs, platformFeeTzs } = grossUpWithdrawal(net, undefined, fee)
        expect(burnAmountTzs).toBe(net + fee + platformFeeTzs)
        expect(netPayoutTzs({ amountTzs: burnAmountTzs, platformFeeTzs, pspFeeTzs: fee })).toBe(net)
      }
    }
  })
})
