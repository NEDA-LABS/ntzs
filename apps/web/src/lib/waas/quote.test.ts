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
let savedBps: string | undefined
let savedFloor: string | undefined

beforeAll(() => {
  savedSecret = process.env.WAAS_QUOTE_SECRET
  savedFx = process.env.FX_JWT_SECRET
  savedBps = process.env.NEDA_PROTOCOL_FEE_BPS
  savedFloor = process.env.NEDA_PROTOCOL_FEE_FLOOR_TZS
  process.env.WAAS_QUOTE_SECRET = 'test-quote-secret'
  // Pin the protocol fee to its shipped defaults for deterministic burn math.
  process.env.NEDA_PROTOCOL_FEE_BPS = '30'
  process.env.NEDA_PROTOCOL_FEE_FLOOR_TZS = '30'
})

afterAll(() => {
  process.env.WAAS_QUOTE_SECRET = savedSecret
  process.env.FX_JWT_SECRET = savedFx
  process.env.NEDA_PROTOCOL_FEE_BPS = savedBps
  process.env.NEDA_PROTOCOL_FEE_FLOOR_TZS = savedFloor
})

describe('computeWithdrawalGrossUp', () => {
  it('grosses up receive + PSP fee by the platform rate, then adds the NEDA fee on top', () => {
    // receive 5,000 at 0.5%: partnerBurn = ceil(6500 / 0.995) = 6533; NEDA fee
    // = max(5000×30bps=15, floor 30) = 30 → total burn 6563. Partner margin
    // (platformFeeTzs) is UNCHANGED by the add-on.
    const g = computeWithdrawalGrossUp(5000, 0.5)
    expect(g.pspFeeTzs).toBe(PSP_FLAT_FEE_TZS)
    expect(g.platformFeeTzs).toBe(6533 - 5000 - PSP_FLAT_FEE_TZS)
    expect(g.nedaFeeTzs).toBe(30)
    expect(g.burnAmountTzs).toBe(6563)
    // Identity: burn = receive + psp + platform + neda, exactly.
    expect(g.burnAmountTzs).toBe(5000 + g.pspFeeTzs + g.platformFeeTzs + g.nedaFeeTzs)
  })

  it('zero platform fee still carries the PSP flat fee + NEDA fee', () => {
    const g = computeWithdrawalGrossUp(10_000, 0)
    expect(g.platformFeeTzs).toBe(0)
    expect(g.nedaFeeTzs).toBe(30) // max(10000×30bps=30, 30)
    expect(g.burnAmountTzs).toBe(11_530) // 10000 + 1500 + 0 + 30
  })

  it('prices the PSP fee per serving rail when passed (1 Aug 2026: quote said 1,500 while Selcom served at 150)', () => {
    // receive 5,000 with Selcom's tier fee 150 at 0.5%:
    // partnerBurn = ceil(5150 / 0.995) = 5176; NEDA fee 30 → burn 5206.
    const g = computeWithdrawalGrossUp(5000, 0.5, 150)
    expect(g.pspFeeTzs).toBe(150)
    expect(g.platformFeeTzs).toBe(5176 - 5000 - 150)
    expect(g.burnAmountTzs).toBe(5206)
    // Identity holds for ANY rail fee: burn = receive + psp + platform + neda.
    expect(g.burnAmountTzs).toBe(5000 + g.pspFeeTzs + g.platformFeeTzs + g.nedaFeeTzs)
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
