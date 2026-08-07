import { describe, it, expect } from 'vitest'

import { actionDisposition, canDecide } from './access-policy'

describe('actionDisposition (H8 — maker-checker + least-privilege)', () => {
  it('lets owner and approver act directly', () => {
    expect(actionDisposition('owner')).toBe('direct')
    expect(actionDisposition('approver')).toBe('direct')
  })

  it('treats a legacy session with no role as owner (direct)', () => {
    expect(actionDisposition(undefined)).toBe('direct')
  })

  it('queues an operator for approval', () => {
    expect(actionDisposition('operator')).toBe('queue')
  })

  it('DENIES the read-only viewer role (regression: H8)', () => {
    expect(actionDisposition('viewer')).toBe('deny')
  })

  it('denies any unrecognized role by default (fail closed)', () => {
    for (const role of ['auditor', 'admin', 'reader', '', 'OWNER', 'Operator']) {
      expect(actionDisposition(role)).toBe('deny')
    }
  })
})

describe('canDecide', () => {
  it('allows owner, approver, and legacy (no role)', () => {
    expect(canDecide('owner')).toBe(true)
    expect(canDecide('approver')).toBe(true)
    expect(canDecide(undefined)).toBe(true)
  })

  it('does not allow operator or viewer to decide', () => {
    expect(canDecide('operator')).toBe(false)
    expect(canDecide('viewer')).toBe(false)
  })
})

describe('actionDisposition — value ceiling', () => {
  it('queues an owner once the amount reaches the threshold', () => {
    expect(actionDisposition('owner', { amount: 1_000_000, threshold: 1_000_000 })).toBe('queue')
    expect(actionDisposition('owner', { amount: 1_500_000, threshold: 1_000_000 })).toBe('queue')
    expect(actionDisposition('approver', { amount: 2_000_000, threshold: 1_000_000 })).toBe('queue')
  })

  it('lets an owner act directly below the threshold', () => {
    expect(actionDisposition('owner', { amount: 999_999, threshold: 1_000_000 })).toBe('direct')
  })

  it('ignores the ceiling when unset, zero, or the amount is unknown', () => {
    expect(actionDisposition('owner', { amount: 5_000_000, threshold: null })).toBe('direct')
    expect(actionDisposition('owner', { amount: 5_000_000, threshold: 0 })).toBe('direct')
    expect(actionDisposition('owner', { threshold: 1_000 })).toBe('direct')
  })

  it('never promotes a denied or queued role', () => {
    // A viewer stays denied however small the amount…
    expect(actionDisposition('viewer', { amount: 1, threshold: 1_000_000 })).toBe('deny')
    // …and an operator still queues below the ceiling.
    expect(actionDisposition('operator', { amount: 1, threshold: 1_000_000 })).toBe('queue')
  })
})
