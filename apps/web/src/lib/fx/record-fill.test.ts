import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import { splitSpread } from './record-fill'

/**
 * 3 Aug 2026: the first live ramp settlement swap moved solver inventory
 * without recording an lp_fills row — the pool reconciler fired on both
 * detectors (unmatched transfers + a solver nTZS deficit vs recorded
 * positions), and the LP earned no recorded spread. Every path that moves
 * solver inventory through executeSwap must book the fill.
 */
describe('splitSpread', () => {
  it('carves the protocol fee from the LP side, never the taker rate', () => {
    // mid 5,300 vs delivered 5,262 → 38 spread; fee = min(38, 5300×20bps=10.6)
    const s = splitSpread(5300, 5262, 20)
    expect(s.totalSpread).toBe(38)
    expect(s.protocolFee).toBeCloseTo(10.6, 6)
    expect(s.lpSpread).toBeCloseTo(27.4, 6)
  })

  it('never goes negative when the fill beats mid', () => {
    const s = splitSpread(5262, 5300, 20)
    expect(s.totalSpread).toBe(0)
    expect(s.protocolFee).toBe(0)
    expect(s.lpSpread).toBe(0)
  })

  it('caps the protocol fee at the whole spread', () => {
    // Tiny spread, big bps → fee is the spread, LP keeps zero, never negative.
    const s = splitSpread(10_000, 9_999, 500)
    expect(s.protocolFee).toBe(1)
    expect(s.lpSpread).toBe(0)
  })
})

describe('fill bookkeeping coverage', () => {
  it('recordLpFill keeps the double-entry semantics of the swap routes', () => {
    const src = fs.readFileSync(path.join(__dirname, 'record-fill.ts'), 'utf8')
    // Debit clamps at zero (rounding dust), credit upserts (missing row must
    // not silently drop received funds from the ledger), and the debit is the
    // FULL outflow: amountOut plus the retained protocol fee.
    expect(src).toContain('GREATEST(0')
    expect(src).toContain('onConflictDoUpdate')
    expect(src).toMatch(/amountOut\}::numeric - \$\{feeStr\}::numeric/)
  })

  it('the ramp settlement engine books its fills', () => {
    const src = fs.readFileSync(path.join(__dirname, '../ramp/offramp.ts'), 'utf8')
    expect(src).toContain('recordLpFill(')
    expect(src).toContain("source: 'ramp'")
    // Bookkeeping failure must not strand the settlement — logged, not thrown.
    expect(src).toContain('Failed to record fill')
  })
})
