import { describe, it, expect } from 'vitest'

import { matchNames, sameIdNumber, tokenizeName } from './name-match'

describe('sameIdNumber', () => {
  it('matches dashed vs plain NIDA formats', () => {
    expect(sameIdNumber('19990102-61401-00001-20', '19990102614010000120')).toBe(true)
  })
  it('rejects different IDs and empty/short values', () => {
    expect(sameIdNumber('19990102614010000120', '19990102614010000121')).toBe(false)
    expect(sameIdNumber('', '19990102614010000120')).toBe(false)
    expect(sameIdNumber(null, undefined)).toBe(false)
    expect(sameIdNumber('12345', '12345')).toBe(false) // too short to be an ID
  })
})

describe('tokenizeName', () => {
  it('lowercases, strips punctuation, drops single letters', () => {
    expect(tokenizeName('  Asha J. MRISHO ')).toEqual(['asha', 'mrisho'])
  })
})

describe('matchNames (Tier-1 binding rule: ≥2 components agree)', () => {
  it('matches identical names regardless of case', () => {
    expect(matchNames('Asha Juma Mrisho', 'ASHA JUMA MRISHO').matched).toBe(true)
  })

  it('matches with token order swapped (registries differ on ordering)', () => {
    expect(matchNames('Asha Juma Mrisho', 'Mrisho Asha').matched).toBe(true)
  })

  it('matches when the middle name is dropped on one side', () => {
    expect(matchNames('Asha Juma Mrisho', 'Asha Mrisho').matched).toBe(true)
  })

  it('tolerates a single-character typo in a long token', () => {
    expect(matchNames('Asha Mrisho', 'Asha Mriho').matched).toBe(true)
  })

  it('does NOT bind on a single shared first name', () => {
    const r = matchNames('Mohamed Ali', 'Mohamed Juma')
    expect(r.matchedTokens).toBe(1)
    expect(r.matched).toBe(false)
  })

  it('does NOT bind clearly different people', () => {
    const r = matchNames('John Peter Mwakyusa', 'Asha Juma Mrisho')
    expect(r.matchedTokens).toBe(0)
    expect(r.matched).toBe(false)
  })

  it('is not comparable when either side is empty', () => {
    expect(matchNames('', 'Asha Mrisho').comparable).toBe(false)
    expect(matchNames('Asha Mrisho', null).comparable).toBe(false)
  })
})
