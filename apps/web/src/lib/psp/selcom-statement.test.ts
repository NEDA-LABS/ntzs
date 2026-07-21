import { describe, it, expect } from 'vitest'

import {
  parseStatementRow,
  extractPhone,
  isWithinMatchWindow,
  ymdEAT,
  W2B_CLOCK_SLACK_MS,
} from './selcom-statement'

describe('parseStatementRow', () => {
  it('parses an explicit-direction credit row (drcr style)', () => {
    const parsed = parseStatementRow({
      date: '2026-07-21 10:15:00',
      receipt: 'ABC123XYZ',
      drcr: 'CR',
      amount: '12,500.00',
      narrative: 'W2B PAYMENT FROM 255744277496 JOHN DOE',
      channel: 'LNM',
    })
    expect(parsed.kind).toBe('credit')
    if (parsed.kind !== 'credit') return
    expect(parsed.reference).toBe('ABC123XYZ')
    expect(parsed.amountTzs).toBe(12500)
    expect(parsed.payerPhone).toBe('255744277496') // extracted from narrative
    expect(parsed.channel).toBe('LNM')
    expect(parsed.occurredAt).toBeInstanceOf(Date)
  })

  it('parses a transaction_type CREDIT row with dedicated msisdn field', () => {
    const parsed = parseStatementRow({
      transaction_id: 'TX-9',
      transaction_type: 'CREDIT',
      amount: 5000,
      msisdn: '0744277496',
      sender_name: 'JANE',
    })
    expect(parsed.kind).toBe('credit')
    if (parsed.kind !== 'credit') return
    expect(parsed.payerPhone).toBe('0744277496')
    expect(parsed.payerName).toBe('JANE')
  })

  it('classifies via separate credit/debit amount columns', () => {
    const credit = parseStatementRow({ reference: 'R1', credit: '7000', debit: '0' })
    expect(credit.kind).toBe('credit')
    if (credit.kind === 'credit') expect(credit.amountTzs).toBe(7000)

    const debit = parseStatementRow({ reference: 'R2', credit: '0', debit: '7000' })
    expect(debit.kind).toBe('debit')
  })

  it('treats a negative signed amount as a debit', () => {
    expect(parseStatementRow({ reference: 'R3', amount: -4000 }).kind).toBe('debit')
  })

  it('never treats a bare positive amount as a credit (no direction info)', () => {
    const parsed = parseStatementRow({ reference: 'R4', amount: 4000 })
    expect(parsed).toEqual({ kind: 'skipped', reason: 'no direction field' })
  })

  it('skips credits without a usable reference', () => {
    const parsed = parseStatementRow({ drcr: 'CR', amount: 4000 })
    expect(parsed).toEqual({ kind: 'skipped', reason: 'no reference field' })
  })

  it('skips explicit debits regardless of other fields', () => {
    expect(parseStatementRow({ receipt: 'R5', type: 'DEBIT', amount: 9000 }).kind).toBe('debit')
  })

  it('skips zero-amount and amountless rows', () => {
    expect(parseStatementRow({ receipt: 'R6', drcr: 'CR', amount: '0' })).toEqual({
      kind: 'skipped',
      reason: 'non-positive amount',
    })
    expect(parseStatementRow({ receipt: 'R7', drcr: 'CR' })).toEqual({
      kind: 'skipped',
      reason: 'no amount field',
    })
  })
})

describe('extractPhone', () => {
  it('finds MSISDNs in narratives across formats', () => {
    expect(extractPhone('PAY 255744277496 REF X')).toBe('255744277496')
    expect(extractPhone('from +255769527679 ok')).toBe('255769527679')
    expect(extractPhone('sender 0714641171')).toBe('0714641171')
    expect(extractPhone('no phone here')).toBeNull()
    expect(extractPhone(null)).toBeNull()
  })
})

describe('isWithinMatchWindow', () => {
  const intent = new Date('2026-07-21T10:00:00Z')

  it('accepts payments after the intent within 72h', () => {
    expect(isWithinMatchWindow(intent, new Date('2026-07-21T10:30:00Z'))).toBe(true)
    expect(isWithinMatchWindow(intent, new Date('2026-07-24T09:59:00Z'))).toBe(true)
  })

  it('accepts slight clock skew but rejects payments clearly before the intent', () => {
    expect(isWithinMatchWindow(intent, new Date(intent.getTime() - W2B_CLOCK_SLACK_MS + 1000))).toBe(true)
    expect(isWithinMatchWindow(intent, new Date('2026-07-21T09:00:00Z'))).toBe(false)
  })

  it('rejects payments outside the 72h window', () => {
    expect(isWithinMatchWindow(intent, new Date('2026-07-25T10:01:00Z'))).toBe(false)
  })
})

describe('ymdEAT', () => {
  it('rolls the date at 21:00 UTC (midnight EAT)', () => {
    expect(ymdEAT(new Date('2026-07-21T20:59:00Z'))).toBe('2026-07-21')
    expect(ymdEAT(new Date('2026-07-21T21:01:00Z'))).toBe('2026-07-22')
  })
})
