import { describe, it, expect } from 'vitest'

import { computeAnnex, type ReservePot } from './attestation-math'

const pot = (key: string, amountTzs: number, source: 'api' | 'book' | 'env' = 'api'): ReservePot => ({
  key,
  label: key,
  source,
  amountTzs,
  asOf: '2026-07-21T07:00:00.000Z',
})

describe('computeAnnex', () => {
  it('reconciles a fully-explained over-backed reading to ~100% adjusted', () => {
    // Supply 5.8M; Snippe holds 6.13M (raw 105.69%). The excess is entirely
    // burned-unpaid + unminted fees + orphans; AzamPay book money backs
    // paid-but-unminted obligations 1:1.
    const annex = computeAnnex({
      pots: [pot('snippe', 6_130_000), pot('azampay', 60_000, 'book')],
      nettings: {
        burnedUnpaidTzs: 180_000,
        feesUnmintedTzs: 110_000,
        orphanUnmatchedTzs: 40_000,
        paidUnmintedTzs: 60_000,
      },
      totalSupplyTzs: 5_800_000,
    })
    expect(annex.grossReservesTzs).toBe(6_190_000)
    expect(annex.backingReservesTzs).toBe(5_860_000)
    expect(annex.effectiveObligationsTzs).toBe(5_860_000)
    expect(annex.adjustedCoveragePct).toBe(100)
    expect(annex.residualPct).toBe(0)
    // Raw deviation still reflects the BoT (d) figure.
    expect(annex.rawDeviationPct).toBeCloseTo(6.7241, 3)
  })

  it('surfaces an unexplained shortfall as a negative residual', () => {
    const annex = computeAnnex({
      pots: [pot('snippe', 5_700_000)],
      nettings: { burnedUnpaidTzs: 0, feesUnmintedTzs: 0, orphanUnmatchedTzs: 0, paidUnmintedTzs: 0 },
      totalSupplyTzs: 5_800_000,
    })
    expect(annex.adjustedCoveragePct).toBeCloseTo(98.2759, 3)
    expect(annex.residualPct).toBeLessThan(0)
    expect(annex.rawDeviationPct).toBeCloseTo(-1.7241, 3)
  })

  it('handles zero supply without dividing by zero', () => {
    const annex = computeAnnex({
      pots: [pot('snippe', 1000)],
      nettings: { burnedUnpaidTzs: 0, feesUnmintedTzs: 0, orphanUnmatchedTzs: 0, paidUnmintedTzs: 0 },
      totalSupplyTzs: 0,
    })
    expect(annex.rawDeviationPct).toBe(0)
    expect(annex.adjustedCoveragePct).toBe(100) // zero obligations → guarded sentinel, not ∞
  })

  it('a positive residual persists when reserves exceed all named wedges', () => {
    // Opening float / fee spread scenario: 50k sits in the pot that no
    // netting line claims — the residual must expose it, not absorb it.
    const annex = computeAnnex({
      pots: [pot('snippe', 5_850_000)],
      nettings: { burnedUnpaidTzs: 0, feesUnmintedTzs: 0, orphanUnmatchedTzs: 0, paidUnmintedTzs: 0 },
      totalSupplyTzs: 5_800_000,
    })
    expect(annex.residualPct).toBeCloseTo(0.8621, 3)
  })
})
