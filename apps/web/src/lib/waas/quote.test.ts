import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  computeWithdrawalGrossUp,
  createQuoteToken,
  verifyQuoteToken,
  QUOTE_TTL_MS,
  PSP_FLAT_FEE_TZS,
} from './quote'

let savedSecret: string | undefined
let savedFx: string | undefined

beforeAll(() => {
  savedSecret = process.env.WAAS_QUOTE_SECRET
  savedFx = process.env.FX_JWT_SECRET
  process.env.WAAS_QUOTE_SECRET = 'test-quote-secret'
})

afterAll(() => {
  process.env.WAAS_QUOTE_SECRET = savedSecret
  process.env.FX_JWT_SECRET = savedFx
})

describe('computeWithdrawalGrossUp', () => {
  it('grosses up receive + PSP fee by the platform fee rate (ceil)', () => {
    // receive 5,000 at 0.5%: ceil(6500 / 0.995) = 6533
    const g = computeWithdrawalGrossUp(5000, 0.5)
    expect(g.burnAmountTzs).toBe(6533)
    expect(g.pspFeeTzs).toBe(PSP_FLAT_FEE_TZS)
    expect(g.platformFeeTzs).toBe(6533 - 5000 - PSP_FLAT_FEE_TZS)
    // Identity: burn = receive + psp + platform, exactly.
    expect(g.burnAmountTzs).toBe(5000 + g.pspFeeTzs + g.platformFeeTzs)
  })

  it('zero platform fee still carries the PSP flat fee', () => {
    const g = computeWithdrawalGrossUp(10_000, 0)
    expect(g.burnAmountTzs).toBe(11_500)
    expect(g.platformFeeTzs).toBe(0)
  })
})

describe('quote tokens', () => {
  const terms = {
    partnerId: 'p-1',
    userId: 'u-1',
    phone: '255744277496',
    receiveAmountTzs: 5000,
    burnAmountTzs: 6533,
    platformFeeTzs: 33,
  }

  it('round-trips a signed quote within its TTL', () => {
    const now = 1_700_000_000_000
    const token = createQuoteToken(terms, now)
    expect(token).toBeTruthy()
    const v = verifyQuoteToken(token!, now + QUOTE_TTL_MS - 1000)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.payload.userId).toBe('u-1')
      expect(v.payload.burnAmountTzs).toBe(6533)
      expect(v.payload.exp).toBe(now + QUOTE_TTL_MS)
    }
  })

  it('rejects expiry, tampering, and malformed tokens', () => {
    const now = 1_700_000_000_000
    const token = createQuoteToken(terms, now)!
    expect(verifyQuoteToken(token, now + QUOTE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' })

    // Tamper with the payload (raise the receive amount) keeping the old signature.
    const [body, sig] = token.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    payload.receiveAmountTzs = 500_000
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`
    expect(verifyQuoteToken(forged, now)).toEqual({ ok: false, reason: 'bad_signature' })

    expect(verifyQuoteToken('not-a-token', now)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('fails closed when no secret is configured', () => {
    const prev = process.env.WAAS_QUOTE_SECRET
    delete process.env.WAAS_QUOTE_SECRET
    delete process.env.FX_JWT_SECRET
    expect(createQuoteToken(terms)).toBeNull()
    expect(verifyQuoteToken('a.b')).toEqual({ ok: false, reason: 'unconfigured' })
    process.env.WAAS_QUOTE_SECRET = prev
  })
})
