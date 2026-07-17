import { describe, it, expect } from 'vitest'

import { classifyEvent, categorizeEvent, parseRange } from './feed'

describe('classifyEvent', () => {
  it('platform faults are errors', () => {
    expect(classifyEvent('payout_failed', null)).toBe('error')
    expect(classifyEvent('burn_failed', null)).toBe('error')
    expect(classifyEvent('deposit.mint_failed', null)).toBe('error')
    expect(classifyEvent('payout_gate_closed', null)).toBe('error')
    expect(classifyEvent('burn_fee_mint_failed', null)).toBe('error')
    expect(classifyEvent('loan_auto_reverted', null)).toBe('error')
  })

  it('human decisions and in-between states are warnings, not errors', () => {
    expect(classifyEvent('kyc.rejected', null)).toBe('warning')
    expect(classifyEvent('deposit.rejected', null)).toBe('warning')
    expect(classifyEvent('orphan.unmatched', null)).toBe('warning')
    expect(classifyEvent('kyc.pending', null)).toBe('warning')
    expect(classifyEvent('deposit.mint_requires_safe', null)).toBe('warning')
  })

  it('completed lifecycle states are info', () => {
    expect(classifyEvent('deposit.minted', null)).toBe('info')
    expect(classifyEvent('burn.burned', null)).toBe('info')
    expect(classifyEvent('payout_initiated', null)).toBe('info')
    expect(classifyEvent('kyc.approved', null)).toBe('info')
    expect(classifyEvent('partner.name_lookup', null)).toBe('info')
  })

  it('psp.health: warning only at a transition, info in steady state (even DOWN)', () => {
    expect(classifyEvent('psp.health', { state: { snippe: true }, transitions: [] })).toBe('info')
    expect(classifyEvent('psp.health', { state: { azampay: false }, transitions: [] })).toBe('info')
    expect(classifyEvent('psp.health', { transitions: ['azampay: UP → DOWN'] })).toBe('warning')
  })
})

describe('categorizeEvent', () => {
  it('lifecycle sources map to their category regardless of action text', () => {
    expect(categorizeEvent('deposit', 'deposit.minted', 'deposit_request', false)).toBe('payment')
    expect(categorizeEvent('orphan', 'orphan.unmatched', 'orphan_payment', false)).toBe('payment')
    expect(categorizeEvent('burn', 'burn.burned', 'burn_request', false)).toBe('burn')
    expect(categorizeEvent('kyc', 'kyc.pending', 'kyc_case', false)).toBe('kyc')
  })

  it('audit actions map by prefix and keywords', () => {
    expect(categorizeEvent('audit', 'psp.health', 'psp_rail', false)).toBe('psp')
    expect(categorizeEvent('audit', 'payout_failed', 'burn_request', false)).toBe('burn')
    expect(categorizeEvent('audit', 'kyc.approved', 'kyc_case', true)).toBe('kyc')
    expect(categorizeEvent('audit', 'partner.name_lookup', 'partner', false)).toBe('partner')
    expect(categorizeEvent('audit', 'lender_loan_paid_off', 'enterprise_loan_agreement', false)).toBe('enterprise')
  })

  it('unknown audit actions: operator-initiated → admin, machine → other', () => {
    expect(categorizeEvent('audit', 'user_role_changed', 'user', true)).toBe('admin')
    expect(categorizeEvent('audit', 'mystery_machine_event', 'thing', false)).toBe('other')
  })
})

describe('parseRange', () => {
  it('accepts known keys and defaults to 24h', () => {
    expect(parseRange('1h')).toEqual({ key: '1h', hours: 1 })
    expect(parseRange('7d')).toEqual({ key: '7d', hours: 168 })
    expect(parseRange(undefined)).toEqual({ key: '24h', hours: 24 })
    expect(parseRange('junk')).toEqual({ key: '24h', hours: 24 })
  })
})
