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
