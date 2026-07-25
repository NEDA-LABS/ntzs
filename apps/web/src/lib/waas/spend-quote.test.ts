import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  computeSpendTotals,
  createSpendQuoteToken,
  verifySpendQuoteToken,
  spendTarget,
  SPEND_MIN_TZS,
} from './spend-quote'
import { createQuoteToken } from './quote'

const SAVED_SECRET = process.env.WAAS_QUOTE_SECRET

beforeAll(() => {
  process.env.WAAS_QUOTE_SECRET = 'test-spend-secret'
})
afterAll(() => {
  process.env.WAAS_QUOTE_SECRET = SAVED_SECRET
})

describe('computeSpendTotals (burn = principal + selcomFee + platformFee)', () => {
  it('prices the measured live case: 1,000 TZS lipa → 30 TZS selcom fee', () => {
    // Live evidence 25 Jul (ref 202607250630): principal 1000, charges 30.
    const t = computeSpendTotals('lipa', 1000, 0.5)
    expect(t.selcomFeeTzs).toBe(30)
    expect(t.platformFeeTzs).toBe(5) // ceil(1000 * 0.5%)
    expect(t.burnAmountTzs).toBe(1035)
  })

  it('scales through lipa tariff tiers and always ceils the platform fee', () => {
    const t = computeSpendTotals('lipa', 50_000, 0.5)
    expect(t.selcomFeeTzs).toBe(550) // published Lipa/TanQR tier
    expect(t.platformFeeTzs).toBe(250)
    expect(t.burnAmountTzs).toBe(50_800)

    const odd = computeSpendTotals('lipa', 501, 1)
    expect(odd.platformFeeTzs).toBe(6) // ceil(5.01)
  })

  it('bills: government billers are FREE up to 20,000 then tiered (dashboard 25 Jul)', () => {
    expect(computeSpendTotals('bill', 15_000, 0.5, 'GEPG').selcomFeeTzs).toBe(0)
    expect(computeSpendTotals('bill', 20_000, 0.5, 'DAWASA').selcomFeeTzs).toBe(0)
    expect(computeSpendTotals('bill', 25_000, 0.5, 'GEPG').selcomFeeTzs).toBe(200)
    expect(computeSpendTotals('bill', 75_000, 0.5, 'TRAFFICFINE').selcomFeeTzs).toBe(500)
  })

  it('bills: charged billers (LUKU) use the commercial tiers; unknown codes price conservatively', () => {
    expect(computeSpendTotals('bill', 1_000, 0.5, 'LUKU').selcomFeeTzs).toBe(12)
    expect(computeSpendTotals('bill', 10_000, 0.5, 'LUKU').selcomFeeTzs).toBe(120)
    expect(computeSpendTotals('bill', 100_000, 0.5, 'LUKU').selcomFeeTzs).toBe(800)
    // Not in the dashboard's government label → charged table until confirmed.
    expect(computeSpendTotals('bill', 1_000, 0.5, 'ZANMALIPO').selcomFeeTzs).toBe(12)
    expect(computeSpendTotals('bill', 1_000, 0.5, 'DSTV').selcomFeeTzs).toBe(12)
  })

  it('exposes a sane minimum', () => {
    expect(SPEND_MIN_TZS).toBeGreaterThan(0)
  })
})

describe('spendTarget (canonical destination string)', () => {
  it('discriminates lipa and bill targets', () => {
    expect(spendTarget('lipa', { payNumber: '61115582' })).toBe('lipa:61115582')
    expect(spendTarget('bill', { utilityCode: 'LUKU', utilityRef: '01234567890' })).toBe('bill:LUKU:01234567890')
  })
})

describe('spend quote tokens', () => {
  const payload = {
    kind: 'lipa' as const,
    partnerId: 'p-1',
    userId: 'u-1',
    target: 'lipa:61115582',
    principalTzs: 1000,
    selcomFeeTzs: 30,
    platformFeeTzs: 5,
    burnAmountTzs: 1035,
    recipientName: 'ENZI COFFEE COMPANY LIMITED',
  }

  it('round-trips a signed token', () => {
    const token = createSpendQuoteToken(payload)
    expect(token).toBeTruthy()
    const v = verifySpendQuoteToken(token as string)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.payload.k).toBe('spend')
      expect(v.payload.target).toBe('lipa:61115582')
      expect(v.payload.burnAmountTzs).toBe(1035)
      expect(v.payload.recipientName).toBe('ENZI COFFEE COMPANY LIMITED')
    }
  })

  it('rejects tampering with the economic terms', () => {
    const token = createSpendQuoteToken(payload) as string
    const [body] = token.split('.')
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString())
    decoded.burnAmountTzs = 1 // pay less, receive same
    const forgedBody = Buffer.from(JSON.stringify(decoded)).toString('base64url')
    const forged = `${forgedBody}.${token.split('.')[1]}`
    const v = verifySpendQuoteToken(forged)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('bad_signature')
  })

  it('expires after the TTL', () => {
    const token = createSpendQuoteToken(payload, 1_000_000) as string
    const v = verifySpendQuoteToken(token, 1_000_000 + 6 * 60 * 1000)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('expired')
  })

  it('REFUSES a withdrawal-quote token in the spend space (kind discriminator)', () => {
    const withdrawalToken = createQuoteToken({
      partnerId: 'p-1',
      userId: 'u-1',
      phone: '0744277496',
      receiveAmountTzs: 1000,
      burnAmountTzs: 2513,
      platformFeeTzs: 13,
    })
    expect(withdrawalToken).toBeTruthy()
    const v = verifySpendQuoteToken(withdrawalToken as string)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('wrong_kind')
  })
})
