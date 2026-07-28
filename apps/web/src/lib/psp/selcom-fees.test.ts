import { describe, it, expect } from 'vitest'

import { estimateSpendFee, estimateSendMoneyFee, estimateBillPayFee } from './selcom-fees'

describe('estimateSpendFee (destination-kind fee router)', () => {
  it('lipa uses the Lipa/TanQR tariff', () => {
    expect(estimateSpendFee('lipa', 1000)).toBe(estimateSendMoneyFee(1000))
    expect(estimateSpendFee('lipa', 1000)).toBe(30)
    expect(estimateSpendFee('lipa', 50_000)).toBe(550)
  })

  it('bill routes by biller group — government free ≤20k, commercial tiered', () => {
    expect(estimateSpendFee('bill', 15_000, 'GEPG')).toBe(0)
    expect(estimateSpendFee('bill', 25_000, 'GEPG')).toBe(200)
    expect(estimateSpendFee('bill', 1_000, 'LUKU')).toBe(12)
    expect(estimateSpendFee('bill', 1_000, 'LUKU')).toBe(estimateBillPayFee('LUKU', 1_000))
  })

  it('unknown / missing biller code falls back to the charged tier (conservative)', () => {
    expect(estimateSpendFee('bill', 1_000)).toBe(estimateBillPayFee('', 1_000))
    expect(estimateSpendFee('bill', 1_000, 'DSTV')).toBe(12)
  })
})
