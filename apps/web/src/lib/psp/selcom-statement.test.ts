import { describe, it, expect } from 'vitest'

import {
  parseStatementRow,
  extractPhone,
  isWithinMatchWindow,
  ymdEAT,
  W2B_CLOCK_SLACK_MS,
  W2B_CHANNEL,
  BANK_CHANNEL,
  STATEMENT_SETTLED_CHANNELS,
  generateBankReference,
  formatBankReference,
  bankReferenceInText,
  suggestBankMatch,
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

/**
 * Banking phase 3 (3 Aug 2026): bank/TIPS credits carry no payer phone, so
 * bank-transfer deposits match on a generated reference token the payer types
 * into the transfer narration. These pin the token contract end to end.
 */

describe('bank reference tokens', () => {
  it('generates NTZ + 6 chars from the unambiguous alphabet only', () => {
    for (let i = 0; i < 200; i++) {
      const token = generateBankReference()
      expect(token).toMatch(/^NTZ[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/)
      // The glyphs people misread over the phone must never appear.
      expect(token.slice(3)).not.toMatch(/[ILOU01]/)
    }
  })

  it('does not repeat across a realistic burst', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) seen.add(generateBankReference())
    expect(seen.size).toBe(500)
  })

  it('formats with a display dash and round-trips already-formatted input', () => {
    expect(formatBankReference('NTZ7K2M9Q')).toBe('NTZ-7K2M9Q')
    expect(formatBankReference('NTZ-7K2M9Q')).toBe('NTZ-7K2M9Q')
    expect(formatBankReference('ntz7k2m9q')).toBe('NTZ-7K2M9Q')
  })

  it('finds tokens in free text across the punctuation banks insert', () => {
    expect(bankReferenceInText('NTZ7K2M9Q', 'TRF FROM VICTOR REF NTZ-7K2M9Q TIPS')).toBe(true)
    expect(bankReferenceInText('NTZ7K2M9Q', 'ntz 7k2 m9q deposit')).toBe(true)
    expect(bankReferenceInText('NTZ7K2M9Q', 'PAY/NTZ.7K2M9Q/CRDB')).toBe(true)
    expect(bankReferenceInText('NTZ7K2M9Q', 'NEDA DEPOSIT NO REFERENCE')).toBe(false)
    expect(bankReferenceInText('NTZ7K2M9Q', null)).toBe(false)
  })

  it('refuses degenerate tokens so a truncated value can never match everything', () => {
    expect(bankReferenceInText('NTZ', 'NTZ SOMETHING')).toBe(false)
    expect(bankReferenceInText('', 'anything')).toBe(false)
  })
})

describe('suggestBankMatch', () => {
  const intents = [
    { id: 'a', amountTzs: 10000, reference: 'NTZ7K2M9Q' },
    { id: 'b', amountTzs: 25000, reference: 'NTZWX3P8D' },
  ]

  it('matches on token + exact amount', () => {
    const { exact } = suggestBankMatch(
      { amountTzs: 10000, fields: ['TIPS TRANSFER REF NTZ-7K2M9Q', null] },
      intents
    )
    expect(exact?.id).toBe('a')
  })

  it('searches every field, including payer name, never concatenating them', () => {
    const byName = suggestBankMatch({ amountTzs: 25000, fields: [null, 'NTZWX3P8D VICTOR'] }, intents)
    expect(byName.exact?.id).toBe('b')
    // A token split ACROSS two fields must not assemble into a match.
    const split = suggestBankMatch({ amountTzs: 10000, fields: ['REF NTZ7K2', 'M9Q END'] }, intents)
    expect(split.candidates).toHaveLength(0)
  })

  it('token found but amount wrong → candidate, NOT auto-match (human decides)', () => {
    const { exact, candidates } = suggestBankMatch(
      { amountTzs: 9500, fields: ['REF NTZ7K2M9Q'] },
      intents
    )
    expect(exact).toBeNull()
    expect(candidates.map((c) => c.id)).toEqual(['a'])
  })

  it('two intents matched in one credit → never auto-match', () => {
    const { exact, candidates } = suggestBankMatch(
      { amountTzs: 10000, fields: ['NTZ7K2M9Q AND NTZWX3P8D'] },
      intents
    )
    expect(exact).toBeNull()
    expect(candidates).toHaveLength(2)
  })

  it('no token → no candidates', () => {
    const { exact, candidates } = suggestBankMatch({ amountTzs: 10000, fields: ['PLAIN DEPOSIT'] }, intents)
    expect(exact).toBeNull()
    expect(candidates).toHaveLength(0)
  })
})

describe('statement-settled channel registry', () => {
  it('covers exactly the channels poll-selcom must never sweep', () => {
    expect(STATEMENT_SETTLED_CHANNELS).toContain(W2B_CHANNEL)
    expect(STATEMENT_SETTLED_CHANNELS).toContain(BANK_CHANNEL)
    expect(BANK_CHANNEL).toBe('SELCOM-BANK')
  })
})
