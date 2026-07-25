import { describe, it, expect } from 'vitest'

import { SELCOM_BILLERS, getBiller, validateUtilityRef } from './selcom-billers'

describe('selcom-billers catalogue (SB Biller Codes PDF, 25 Jul 2026)', () => {
  it('has unique codes and every category populated', () => {
    const codes = SELCOM_BILLERS.map((b) => b.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const cat of ['utility', 'tv', 'internet', 'government', 'travel']) {
      expect(SELCOM_BILLERS.some((b) => b.category === cat)).toBe(true)
    }
    // Anchors from the PDF
    expect(getBiller('LUKU')?.refLabel).toBe('Meter No')
    expect(getBiller('GEPG')?.refMin).toBe(12)
    expect(getBiller('gepg')?.code).toBe('GEPG') // case-insensitive lookup
  })

  it('validates numeric refs against exact and ranged lengths', () => {
    expect(validateUtilityRef('LUKU', '01234567890').ok).toBe(true) // exactly 11
    expect(validateUtilityRef('LUKU', '0123456789').ok).toBe(false) // 10 — too short
    expect(validateUtilityRef('LUKU', '0123456789x').ok).toBe(false) // non-digit
    expect(validateUtilityRef('TOP', '0744277496').ok).toBe(true) // 10 within 10–12
    expect(validateUtilityRef('TOP', '255744277496').ok).toBe(true) // 12 within 10–12
    expect(validateUtilityRef('TOP', '074427749').ok).toBe(false) // 9 — too short
    expect(validateUtilityRef('GEPG', '991234567890').ok).toBe(true) // exactly 12
  })

  it('validates alphanumeric refs and unbounded numeric refs', () => {
    expect(validateUtilityRef('TARURA', 'T123ABC').ok).toBe(true)
    expect(validateUtilityRef('TARURA', 'T1').ok).toBe(false) // below 3
    expect(validateUtilityRef('TARURA', 'T123-ABC').ok).toBe(false) // charset
    expect(validateUtilityRef('ECOWATER', '12345').ok).toBe(true) // numeric, no bounds
    expect(validateUtilityRef('ECOWATER', '12a45').ok).toBe(false)
  })

  it('unknown codes pass ref validation (product layer gates on getBiller)', () => {
    expect(getBiller('NOTREAL')).toBeUndefined()
    expect(validateUtilityRef('NOTREAL', 'anything-at-all').ok).toBe(true)
  })
})
