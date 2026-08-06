import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import { computeSpendTotals } from './spend-quote'
import { DEFAULT_PLATFORM_FEE_PERCENT } from './quote'

/**
 * Reported 6 Aug 2026: a 1,000 TZS GOVERNMENT bill was charged 35 TZS while the
 * bill picker advertised "no fee under 20,000 TZS".
 *
 * Nothing was miscalculated. The flag was derived from the Selcom leg alone,
 * which genuinely is zero for government billers under the threshold — but two
 * other components apply to every spend regardless of biller or amount, so the
 * badge promised a payer something the quote then did not honour.
 *
 * These tests pin the disclosure, not the price. What we charge is a business
 * decision; telling a payer they will be charged nothing and then charging them
 * is not.
 */

describe('the charge the payer actually sees on a small government bill', () => {
  it('is not zero, and is exactly what was reported', () => {
    const totals = computeSpendTotals('bill', 1000, DEFAULT_PLATFORM_FEE_PERCENT, 'GEPG')
    expect(totals.selcomFeeTzs).toBe(0) // government tier under 20,000 — the true part
    expect(totals.platformFeeTzs).toBe(5) // ceil(1000 × 0.5%)
    expect(totals.nedaFeeTzs).toBe(30) // protocol floor
    const totalFee = totals.selcomFeeTzs + totals.platformFeeTzs + totals.nedaFeeTzs
    expect(totalFee).toBe(35)
    expect(totals.burnAmountTzs).toBe(1035)
  })

  it('carries a fee at every amount, because the protocol fee has a floor', () => {
    // There is no government bill small enough to be genuinely free, which is
    // exactly why a "no fee" badge could never have been honest.
    for (const amount of [500, 1000, 5000, 19_999]) {
      const t = computeSpendTotals('bill', amount, DEFAULT_PLATFORM_FEE_PERCENT, 'GEPG')
      expect(t.selcomFeeTzs, `Selcom leg free at ${amount}`).toBe(0)
      expect(t.nedaFeeTzs + t.platformFeeTzs, `total fee at ${amount}`).toBeGreaterThan(0)
    }
  })
})

describe('what the catalogue tells a partner', () => {
  const route = fs.readFileSync(
    path.join(__dirname, '../../app/api/v1/spend/billers/route.ts'),
    'utf8'
  )

  it('no longer claims the total is free when only the Selcom leg is', () => {
    // The flag must account for the fees that always apply, not just one leg.
    expect(route).toContain('feeFreeUnder20k: selcomFree && unavoidable === 0')
    expect(route).toContain('nedaProtocolFeeTzs')
  })

  it('still surfaces the narrower fact, which is true and worth showing', () => {
    expect(route).toContain('selcomFeeFreeUnder20k: selcomFree')
  })

  it('ships the honest wording so it cannot be paraphrased into a promise', () => {
    expect(route).toContain('A service fee still applies')
    expect(route).toContain('feeNote')
  })

  it('warns integrators off the exact mistake that was made', () => {
    expect(route).toContain('never present selcomFeeFreeUnder20k as "no fee"')
  })
})
