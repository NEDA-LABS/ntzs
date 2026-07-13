import { describe, it, expect } from 'vitest'

import { runIdentityLadder, type IdentityLadderDeps } from './ladder'
import type { BindingOutcome } from './binding'
import type { SelcomVerification } from './selcom'

const NIDA = '19990102614010000120'
const PHONE = '0744000001'

function deps(selcom: SelcomVerification, binding: BindingOutcome): IdentityLadderDeps {
  return {
    verifyPair: async () => selcom,
    bindPhone: async () => binding,
  }
}

const VERIFIED: SelcomVerification = { status: 'verified', reference: 'REF1', fullName: 'ASHA JUMA MRISHO', responseKeys: [] }
const NOT_FOUND: SelcomVerification = { status: 'not_found', message: 'NIDA number is not found!', responseKeys: [] }
const MISMATCH: SelcomVerification = { status: 'mismatch', message: 'Mobile number does not match with the NIDA number.', responseKeys: [] }
const UNAVAILABLE: SelcomVerification = { status: 'unavailable', error: 'HTTP 503' }

const BIND_ID: BindingOutcome = { outcome: 'verified_id', phone: '255744000001', evidence: 'MSISDN registered ID matches NIDA (telco-biometric binding)' }
const BIND_NONE: BindingOutcome = { outcome: 'unverified', phone: '255744000001', evidence: 'MSISDN binding unavailable (no lookup evidence) — NIDA-only verification' }
const BIND_MISMATCH: BindingOutcome = { outcome: 'mismatch', phone: '255744000001', evidence: 'MSISDN is registered to a different ID number' }

describe('runIdentityLadder — decision matrix', () => {
  it('Selcom verified + binding agrees → approved with pair evidence', async () => {
    const v = await runIdentityLadder(deps(VERIFIED, BIND_ID), { nidaNumber: NIDA, phone: PHONE })
    expect(v.outcome).toBe('approved')
    if (v.outcome === 'approved') {
      expect(v.fullName).toBe('ASHA JUMA MRISHO')
      expect(v.evidence).toContain('pair verified')
      expect(v.evidence).toContain('telco-biometric')
    }
  })

  it('Selcom verified + binding silent → still approved (Selcom is primary)', async () => {
    const v = await runIdentityLadder(deps(VERIFIED, BIND_NONE), { nidaNumber: NIDA, phone: PHONE })
    expect(v.outcome).toBe('approved')
  })

  it('Selcom verified but telco registration contradicts → rejected', async () => {
    const v = await runIdentityLadder(deps(VERIFIED, BIND_MISMATCH), { nidaNumber: NIDA, phone: PHONE })
    expect(v.outcome).toBe('rejected')
    if (v.outcome === 'rejected') expect(v.code).toBe('identity_binding_failed')
  })

  it('Selcom pair mismatch → rejected, no Tier B consulted', async () => {
    let bindCalled = false
    const v = await runIdentityLadder(
      { verifyPair: async () => MISMATCH, bindPhone: async () => { bindCalled = true; return BIND_ID } },
      { nidaNumber: NIDA, phone: PHONE }
    )
    expect(v.outcome).toBe('rejected')
    expect(bindCalled).toBe(false)
  })

  it('Selcom no record + telco ID matches NIDA → review, marked STRONG fast-track', async () => {
    const v = await runIdentityLadder(deps(NOT_FOUND, BIND_ID), { nidaNumber: NIDA, phone: PHONE })
    expect(v.outcome).toBe('review')
    if (v.outcome === 'review') {
      expect(v.evidence).toContain('STRONG')
      expect(v.evidence).toContain('no record')
    }
  })

  it('Selcom no record + telco registered to a different ID → rejected', async () => {
    const v = await runIdentityLadder(deps(NOT_FOUND, BIND_MISMATCH), { nidaNumber: NIDA, phone: PHONE })
    expect(v.outcome).toBe('rejected')
    if (v.outcome === 'rejected') expect(v.code).toBe('identity_binding_failed')
  })

  it('Selcom no record + no telco evidence → review (never a dead end)', async () => {
    const v = await runIdentityLadder(deps(NOT_FOUND, BIND_NONE), { nidaNumber: NIDA, phone: PHONE })
    expect(v.outcome).toBe('review')
    if (v.outcome === 'review') expect(v.evidence).not.toContain('STRONG')
  })

  it('Selcom unavailable → unavailable, never a verdict on the person', async () => {
    const v = await runIdentityLadder(deps(UNAVAILABLE, BIND_ID), { nidaNumber: NIDA, phone: PHONE })
    expect(v.outcome).toBe('unavailable')
  })
})
