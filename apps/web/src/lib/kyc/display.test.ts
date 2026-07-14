import { describe, it, expect } from 'vitest'

import { extractNidaHolderName, kycDisplayName } from './display'

describe('extractNidaHolderName', () => {
  it('extracts the holder name from ladder evidence strings', () => {
    expect(
      extractNidaHolderName('NIDA holder: ASHA JUMA MRISHO · Selcom NIDA+MSISDN pair verified · MSISDN binding unavailable (no lookup evidence) — NIDA-only verification')
    ).toBe('ASHA JUMA MRISHO')
  })

  it('extracts from single-segment strings (no trailing evidence)', () => {
    expect(extractNidaHolderName('NIDA holder: JUMA K')).toBe('JUMA K')
  })

  it('returns null when there is no verified name (review/rejected evidence)', () => {
    expect(extractNidaHolderName('Selcom: no record (likely not a Selcom Pesa customer) · MSISDN binding unavailable (no lookup evidence) — NIDA-only verification')).toBeNull()
    expect(extractNidaHolderName('NIDA number is not found!')).toBeNull()
    expect(extractNidaHolderName(null)).toBeNull()
    expect(extractNidaHolderName('')).toBeNull()
  })
})

describe('kycDisplayName', () => {
  it('prefers the verified holder name', () => {
    expect(
      kycDisplayName({ reviewReason: 'NIDA holder: ASHA MRISHO · evidence', declaredName: 'Asha M', email: 'asha@x.tz' })
    ).toBe('ASHA MRISHO')
  })

  it('falls back to declared name, then email local part', () => {
    expect(kycDisplayName({ reviewReason: null, declaredName: 'Asha M', email: 'asha@x.tz' })).toBe('Asha M')
    expect(kycDisplayName({ reviewReason: null, declaredName: '  ', email: 'asha@x.tz' })).toBe('asha')
    expect(kycDisplayName({ reviewReason: null, declaredName: null, email: null })).toBe('Unknown')
  })
})
