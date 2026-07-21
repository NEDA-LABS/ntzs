import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createVerify, generateKeyPairSync } from 'node:crypto'

import { signRequest, detectWalletFiCode, normalizePhone } from './selcom'
import { estimateSendMoneyFee, getPayoutFeeTzs, SNIPPE_FLAT_FEE_TZS } from './selcom-fees'

// signRequest reads SELCOM_API_KEY + SELCOM_PRIVATE_KEY from the environment —
// install a generated keypair for the suite and restore afterwards.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

let savedKey: string | undefined
let savedApi: string | undefined

beforeAll(() => {
  savedKey = process.env.SELCOM_PRIVATE_KEY
  savedApi = process.env.SELCOM_API_KEY
  // base64-encoded PEM — exercises the decode path used for single-line env vars
  process.env.SELCOM_PRIVATE_KEY = Buffer.from(privatePem).toString('base64')
  process.env.SELCOM_API_KEY = 'test-api-key'
})

afterAll(() => {
  process.env.SELCOM_PRIVATE_KEY = savedKey
  process.env.SELCOM_API_KEY = savedApi
})

describe('signRequest (RSA-SHA256 signed headers)', () => {
  it('produces a digest that verifies against the public key over the documented signing string', () => {
    const fields = [
      { name: 'transId', value: 'abc-123' },
      { name: 'amount', value: 5000 },
    ]
    const { headers, body, timestamp } = signRequest(fields)

    // Header set per Selcom docs.
    expect(headers['api-key']).toBe('test-api-key')
    expect(headers['signed-fields']).toBe('transId,amount')
    expect(headers['timestamp']).toBe(timestamp)

    // Body preserves the exact fields + order semantics.
    expect(body).toEqual({ transId: 'abc-123', amount: 5000 })

    // Signature verifies over `timestamp=<ts>&transId=abc-123&amount=5000`.
    const signingString = `timestamp=${timestamp}&transId=abc-123&amount=5000`
    const verifier = createVerify('RSA-SHA256')
    verifier.update(signingString, 'utf8')
    verifier.end()
    expect(verifier.verify(publicPem, headers['digest'], 'base64')).toBe(true)

    // And does NOT verify over a tampered string (amount changed).
    const tampered = `timestamp=${timestamp}&transId=abc-123&amount=5001`
    const v2 = createVerify('RSA-SHA256')
    v2.update(tampered, 'utf8')
    v2.end()
    expect(v2.verify(publicPem, headers['digest'], 'base64')).toBe(false)
  })
})

describe('detectWalletFiCode (prefix → Selcom FI code)', () => {
  it('maps every routable network and fails loudly on unmapped prefixes', () => {
    expect(detectWalletFiCode(normalizePhone('0744277496'))).toBe('VMCASHIN') // Vodacom
    expect(detectWalletFiCode(normalizePhone('0689000000'))).toBe('AMCASHIN') // Airtel
    expect(detectWalletFiCode(normalizePhone('0714641171'))).toBe('TPCASHIN') // Yas/Tigo
    expect(detectWalletFiCode(normalizePhone('0612345678'))).toBe('HPCASHIN') // Halotel
    expect(detectWalletFiCode(normalizePhone('0731234567'))).toBe('TTCASHIN') // TTCL
    expect(() => detectWalletFiCode(normalizePhone('0801234567'))).toThrow(/no wallet FI code/)
  })
})

describe('selcom-fees (published send-money tariff)', () => {
  it('looks up tier charges incl. boundaries', () => {
    expect(estimateSendMoneyFee(500)).toBe(10)
    expect(estimateSendMoneyFee(999)).toBe(10)
    expect(estimateSendMoneyFee(1000)).toBe(30)
    expect(estimateSendMoneyFee(50000)).toBe(550)
    expect(estimateSendMoneyFee(1_000_000)).toBe(1900)
    expect(estimateSendMoneyFee(999_999_999)).toBe(10000)
  })

  it('getPayoutFeeTzs routes by provider with a legacy-Snippe fallback', () => {
    expect(getPayoutFeeTzs('selcom', 10_000)).toBe(300)
    expect(getPayoutFeeTzs('azampay', 10_000)).toBe(100)
    expect(getPayoutFeeTzs('snippe', 10_000)).toBe(SNIPPE_FLAT_FEE_TZS)
    expect(getPayoutFeeTzs(null, 10_000)).toBe(SNIPPE_FLAT_FEE_TZS)
  })
})
