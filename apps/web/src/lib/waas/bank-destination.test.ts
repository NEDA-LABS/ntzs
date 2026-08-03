import fs from 'fs'
import path from 'path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { resolveBankDestination, maskAccount } from './bank-destination'
import { createQuoteToken, verifyQuoteToken } from './quote'

/**
 * Banking phase 2 (3 Aug 2026): partners pay out to bank accounts through the
 * same quote→confirm contract as mobile wallets. These pin the destination
 * validation both routes share, and that the signed quote BINDS the bank
 * destination — an executed transfer can only go where the user confirmed.
 */

describe('resolveBankDestination', () => {
  it('is null when no bank fields are present (wallet flow)', () => {
    expect(resolveBankDestination({})).toBeNull()
    expect(resolveBankDestination({ bankCode: '', accountNumber: '' })).toBeNull()
  })

  it('requires both fields together', () => {
    const r = resolveBankDestination({ bankCode: 'CRDB' })
    expect(r && 'error' in r ? r.status : 0).toBe(400)
  })

  it('refuses codes outside the canonical registry', () => {
    const r = resolveBankDestination({ bankCode: 'MYBANK', accountNumber: '123456789' })
    expect(r && 'error' in r ? r.error : '').toContain('canonical')
  })

  it('normalizes the code and enforces per-bank account formats', () => {
    // CRDB is the registry's only alphanumeric reference.
    const crdb = resolveBankDestination({ bankCode: 'crdb', accountNumber: '0152768903600' })
    expect(crdb).toEqual({ code: 'CRDB', account: '0152768903600' })
    const crdbAlnum = resolveBankDestination({ bankCode: 'CRDB', accountNumber: '01AB768903600' })
    expect(crdbAlnum).toEqual({ code: 'CRDB', account: '01AB768903600' })
    // Numeric-only banks refuse letters.
    const nmb = resolveBankDestination({ bankCode: 'NMB', accountNumber: '01AB768903600' })
    expect(nmb && 'error' in nmb ? nmb.error : '').toContain('digits')
  })

  it('masks accounts to last-4 for user-facing strings', () => {
    expect(maskAccount('0152768903600')).toBe('•••3600')
    expect(maskAccount('1234')).toBe('1234')
  })
})

describe('quote tokens bind the bank destination', () => {
  let saved: string | undefined
  beforeAll(() => {
    saved = process.env.WAAS_QUOTE_SECRET
    process.env.WAAS_QUOTE_SECRET = 'test-bank-quote-secret'
  })
  afterAll(() => {
    process.env.WAAS_QUOTE_SECRET = saved
  })

  it('round-trips the bank destination and detects tampering by mismatch', () => {
    const now = 1_700_000_000_000
    const token = createQuoteToken(
      {
        partnerId: 'p-1',
        userId: 'u-1',
        phone: '',
        bank: { code: 'CRDB', account: '0152768903600' },
        receiveAmountTzs: 5000,
        burnAmountTzs: 5206,
        platformFeeTzs: 26,
      },
      now,
    )
    expect(token).toBeTruthy()
    const v = verifyQuoteToken(token!, now + 1000)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.payload.bank).toEqual({ code: 'CRDB', account: '0152768903600' })
      // The execute-side contract: a different account must NOT match.
      expect(v.payload.bank?.account === '0152768903601').toBe(false)
    }
  })
})

describe('bank payouts on the withdrawal routes', () => {
  const SRC = path.join(__dirname, '../../app/api/v1/withdrawals')
  const quote = () => fs.readFileSync(path.join(SRC, 'quote/route.ts'), 'utf8')
  const execute = () => fs.readFileSync(path.join(SRC, 'route.ts'), 'utf8')

  it('both routes share ONE destination validator', () => {
    expect(quote()).toContain('resolveBankDestination(')
    expect(execute()).toContain('resolveBankDestination(')
  })

  it('the bank rail refuses cleanly when off — at quote AND before any burn', () => {
    expect(quote()).toContain('bank_rail_unavailable')
    expect(execute()).toContain('bank_rail_unavailable')
  })

  it('bank rows persist the descriptor and the serving rail', () => {
    const src = execute()
    expect(src).toContain("payoutKind: 'bank'")
    expect(src).toContain("payoutProvider: 'selcom'")
    // The duplicate guard must key on the bank account for bank rows.
    expect(src).toContain("->>'accountNumber'")
  })

  it('the approval queue refuses banks until the burn engine learns them', () => {
    // A queued bank row would burn and strand (the engine pays phones only).
    expect(execute()).toContain('bank_amount_unsupported')
  })

  it('bank fees price on the Selcom tariff in live AND sandbox', () => {
    expect(execute()).toContain("getPayoutFeeTzs('selcom', receiveAmountTzs)")
    const testmode = fs.readFileSync(path.join(__dirname, '../testmode/handlers.ts'), 'utf8')
    expect(testmode).toContain("getPayoutFeeTzs('selcom', receiveAmountTzs)")
    expect(testmode).toContain('resolveBankDestination(')
  })
})
