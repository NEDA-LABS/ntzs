import { describe, it, expect } from 'vitest'

import { computeLoanPayoffTzs } from './settlement-payoff'

describe('computeLoanPayoffTzs (balance-driven lender payoff — settlement Phase F)', () => {
  it('pays off the full outstanding when the wallet holds more than owed', () => {
    // Merchant owes 15,000, holds 23,270 → clear the whole loan.
    expect(computeLoanPayoffTzs({ totalOwedTzs: 15_000, repaidTzs: 0, balanceTzs: 23_270 })).toBe(15_000)
  })

  it('pays off exactly the remaining balance on a partially-repaid loan', () => {
    // Owes 15,000, already dripped 6,000 → only 9,000 remains.
    expect(computeLoanPayoffTzs({ totalOwedTzs: 15_000, repaidTzs: 6_000, balanceTzs: 20_000 })).toBe(9_000)
  })

  it('pays off when the balance exactly equals the outstanding', () => {
    expect(computeLoanPayoffTzs({ totalOwedTzs: 15_000, repaidTzs: 0, balanceTzs: 15_000 })).toBe(15_000)
  })

  it('NEVER transfers more than what is owed, no matter how large the balance', () => {
    const owed = 15_000
    const amount = computeLoanPayoffTzs({ totalOwedTzs: owed, repaidTzs: 0, balanceTzs: 10_000_000 })
    expect(amount).toBe(owed)
    expect(amount).toBeLessThanOrEqual(owed)
  })

  it('does nothing (0) when the balance cannot cover the full loan — leaves it to the drip', () => {
    expect(computeLoanPayoffTzs({ totalOwedTzs: 15_000, repaidTzs: 0, balanceTzs: 14_999 })).toBe(0)
  })

  it('does nothing (0) when the loan is already fully repaid', () => {
    expect(computeLoanPayoffTzs({ totalOwedTzs: 15_000, repaidTzs: 15_000, balanceTzs: 50_000 })).toBe(0)
  })

  it('does nothing (0) when repaid somehow exceeds owed (no negative/refund transfers)', () => {
    expect(computeLoanPayoffTzs({ totalOwedTzs: 15_000, repaidTzs: 16_000, balanceTzs: 50_000 })).toBe(0)
  })

  it('does nothing (0) when there is nothing owed', () => {
    expect(computeLoanPayoffTzs({ totalOwedTzs: 0, repaidTzs: 0, balanceTzs: 50_000 })).toBe(0)
  })

  it('does nothing (0) when the wallet is empty', () => {
    expect(computeLoanPayoffTzs({ totalOwedTzs: 15_000, repaidTzs: 0, balanceTzs: 0 })).toBe(0)
  })
})
