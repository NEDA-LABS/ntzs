import { describe, it, expect } from 'vitest'

import { samePhone, suggestOrphanMatch, isPhoneMatch } from './orphan-match'

describe('samePhone', () => {
  it('matches local, international and formatted variants of the same line', () => {
    expect(samePhone('0748288520', '255748288520')).toBe(true)
    expect(samePhone('+255 748 288 520', '0748288520')).toBe(true)
    expect(samePhone('255748288520', '255748288520')).toBe(true)
  })
  it('rejects different lines and unusable values', () => {
    expect(samePhone('0748288520', '0748288521')).toBe(false)
    expect(samePhone('', '0748288520')).toBe(false)
    expect(samePhone(null, undefined)).toBe(false)
    expect(samePhone('12345', '12345')).toBe(false) // too short to be an MSISDN
  })
})

describe('suggestOrphanMatch', () => {
  const orphan = { amountTzs: 10000, payerPhone: '255748288520' }

  it('one-clicks the single amount+phone match among other same-amount deposits', () => {
    const deposits = [
      { id: 'a', amountTzs: 10000, buyerPhone: '0748288520' },
      { id: 'b', amountTzs: 10000, buyerPhone: '0713000000' },
      { id: 'c', amountTzs: 50000, buyerPhone: '0748288520' },
    ]
    const r = suggestOrphanMatch(orphan, deposits)
    expect(r.exact?.id).toBe('a')
    expect(r.candidates.map((d) => d.id)).toEqual(['a', 'b']) // phone match first
  })

  it('offers no one-click when the same user submitted twice (two amount+phone matches)', () => {
    const deposits = [
      { id: 'a', amountTzs: 10000, buyerPhone: '0748288520' },
      { id: 'b', amountTzs: 10000, buyerPhone: '255748288520' },
    ]
    const r = suggestOrphanMatch(orphan, deposits)
    expect(r.exact).toBeNull()
    expect(r.candidates).toHaveLength(2) // admin picks either
  })

  it('offers no one-click on amount-only matches, but lists them as candidates', () => {
    const deposits = [{ id: 'a', amountTzs: 10000, buyerPhone: '0713000000' }]
    const r = suggestOrphanMatch(orphan, deposits)
    expect(r.exact).toBeNull()
    expect(r.candidates.map((d) => d.id)).toEqual(['a'])
  })

  it('never matches across different amounts', () => {
    const deposits = [{ id: 'a', amountTzs: 9999, buyerPhone: '0748288520' }]
    const r = suggestOrphanMatch(orphan, deposits)
    expect(r.exact).toBeNull()
    expect(r.candidates).toHaveLength(0)
  })

  it('handles an orphan with no payer phone (amount-only candidates, no one-click)', () => {
    const r = suggestOrphanMatch({ amountTzs: 10000, payerPhone: null }, [
      { id: 'a', amountTzs: 10000, buyerPhone: '0748288520' },
    ])
    expect(r.exact).toBeNull()
    expect(r.candidates).toHaveLength(1)
  })
})

describe('isPhoneMatch', () => {
  it('flags phone-matched candidates and only those', () => {
    const orphan = { amountTzs: 10000, payerPhone: '255748288520' }
    expect(isPhoneMatch(orphan, { id: 'a', amountTzs: 10000, buyerPhone: '0748288520' })).toBe(true)
    expect(isPhoneMatch(orphan, { id: 'b', amountTzs: 10000, buyerPhone: '0713000000' })).toBe(false)
    expect(isPhoneMatch({ amountTzs: 10000, payerPhone: null }, { id: 'c', amountTzs: 10000, buyerPhone: '0748288520' })).toBe(false)
  })
})
