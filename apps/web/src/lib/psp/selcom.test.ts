import fs from 'fs'
import path from 'path'

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createVerify, generateKeyPairSync } from 'node:crypto'

import { signRequest, detectWalletFiCode, normalizePhone, buildBillPayFields, buildLipaFields, buildNedaLookupFields, BANK_FI_CODES } from './selcom'
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

describe('private key input tolerance (env paste shapes)', () => {
  const verify = (ts: string, digest: string) => {
    const v = createVerify('RSA-SHA256')
    v.update(`timestamp=${ts}&transId=t-1`, 'utf8')
    v.end()
    return v.verify(publicPem, digest, 'base64')
  }
  const signOnce = () => {
    const { headers, timestamp } = signRequest([{ name: 'transId', value: 't-1' }])
    return verify(timestamp, headers['digest'])
  }

  it('accepts a raw multi-line PEM', () => {
    process.env.SELCOM_PRIVATE_KEY = privatePem
    expect(signOnce()).toBe(true)
  })

  it('repairs a PEM whose newlines were collapsed by a paste', () => {
    process.env.SELCOM_PRIVATE_KEY = privatePem.replace(/\n/g, ' ')
    expect(signOnce()).toBe(true)
  })

  it('tolerates surrounding quotes and whitespace on the base64 form', () => {
    process.env.SELCOM_PRIVATE_KEY = `  "${Buffer.from(privatePem).toString('base64')}"  `
    expect(signOnce()).toBe(true)
  })

  it('accepts base64-encoded DER (PKCS#8)', () => {
    const der = privateKey.export({ type: 'pkcs8', format: 'der' })
    process.env.SELCOM_PRIVATE_KEY = Buffer.from(der).toString('base64')
    expect(signOnce()).toBe(true)
  })

  it('throws a diagnostic (never key material) on garbage', () => {
    process.env.SELCOM_PRIVATE_KEY = 'definitely-not-a-key!!'
    expect(() => signRequest([{ name: 'transId', value: 't-1' }])).toThrow(/could not be parsed/)
    try {
      signRequest([{ name: 'transId', value: 't-1' }])
    } catch (e) {
      expect((e as Error).message).not.toContain('definitely')
    }
  })

  it('trims paste artifacts off the api key before it reaches the header', () => {
    process.env.SELCOM_PRIVATE_KEY = Buffer.from(privatePem).toString('base64')
    process.env.SELCOM_API_KEY = ' "test-api-key"\n'
    const { headers } = signRequest([{ name: 'transId', value: 't-1' }])
    expect(headers['api-key']).toBe('test-api-key')
  })

  // restore the suite default for the following describes
  it('restores suite key', () => {
    process.env.SELCOM_PRIVATE_KEY = Buffer.from(privatePem).toString('base64')
    process.env.SELCOM_API_KEY = 'test-api-key'
    expect(signOnce()).toBe(true)
  })
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
    // Both content headers required — without Accept their gateway answers
    // validation errors as HTML redirects (Selcom, 25 Jul).
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Accept']).toBe('application/json')

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

describe('makeNumericTransId (neda-endpoint idempotency key)', () => {
  it('produces the 12-digit YYYYMMDD#### shape from the vendor example', async () => {
    const { makeNumericTransId } = await import('./selcom')
    const id = makeNumericTransId(new Date('2026-07-25T10:30:00Z'))
    expect(id).toMatch(/^20260725\d{4}$/)
    expect(id).toHaveLength(12)
  })
})

describe('postSignedTransaction non-JSON answers (via payLipa)', () => {
  it('surfaces HTTP status + content snippet when the gateway returns an HTML page', async () => {
    const { payLipa } = await import('./selcom')
    const fetchMock = vi.fn().mockResolvedValue({
      status: 404,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<div class="error-page">404 Not Found</div>',
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    try {
      const pending = payLipa({ payNumber: '70031820', amountTzs: 1000, transId: 't-nonjson-1' })
      await vi.advanceTimersByTimeAsync(10_000) // burn through the retry backoffs
      const result = await pending
      expect(result.success).toBe(false)
      expect(result.error).toContain('HTTP 404')
      expect(result.error).toContain('non-JSON')
      expect(result.error).toContain('text/html')
      expect(fetchMock).toHaveBeenCalledTimes(3) // retried — transId is idempotent
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})

describe('checkPayoutStatus FAILED mapping (live payload shape, 25 Jul)', () => {
  it('maps FAIL and drops the generic envelope message as a failure reason', async () => {
    const { checkPayoutStatus } = await import('./selcom')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          error_code: '000',
          message: 'Transaction status retrieved.',
          result: 'FAIL',
          resultcode: '200',
          data: { transId: '202607259640', status: 'FAILED', amount: '1030.00' },
        }),
      })
    )
    try {
      const r = await checkPayoutStatus('202607259640')
      expect(r.status).toBe('failed')
      expect(r.failureReason).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('bill-pay / lipa field builders (order defines body + signature)', () => {
  const signingStringFor = (fields: ReturnType<typeof buildBillPayFields>) => {
    const { headers, timestamp } = signRequest(fields)
    const expected = `timestamp=${timestamp}&` + fields.map((f) => `${f.name}=${f.value}`).join('&')
    const v = createVerify('RSA-SHA256')
    v.update(expected, 'utf8')
    v.end()
    return { verifies: v.verify(publicPem, headers['digest'], 'base64'), signedFields: headers['signed-fields'] }
  }

  it('bill-pay: transId, utilityCode, utilityRef, amount — exactly the collection order', () => {
    const fields = buildBillPayFields({ utilityCode: 'ATOP', utilityRef: '0744277496', amountTzs: 1000 }, 't-bill-1')
    expect(fields.map((f) => f.name)).toEqual(['transId', 'utilityCode', 'utilityRef', 'amount'])
    const { verifies, signedFields } = signingStringFor(fields)
    expect(signedFields).toBe('transId,utilityCode,utilityRef,amount')
    expect(verifies).toBe(true)
  })

  it('lipa: includes network between payNumber and amount when provided', () => {
    const fields = buildLipaFields({ payNumber: '123456', network: 'VODACOM', amountTzs: 500 }, 't-lipa-1')
    expect(fields.map((f) => f.name)).toEqual(['transId', 'payNumber', 'network', 'amount'])
    const { verifies, signedFields } = signingStringFor(fields)
    expect(signedFields).toBe('transId,payNumber,network,amount')
    expect(verifies).toBe(true)
  })

  it('neda-lookup: bank, account, transId — exactly the collection order', async () => {
    const { buildNedaLookupFields } = await import('./selcom')
    const fields = buildNedaLookupFields('SB2LIPA', '61115582', '202607250001')
    expect(fields.map((f) => f.name)).toEqual(['bank', 'account', 'transId'])
    const { verifies, signedFields } = signingStringFor(fields)
    expect(signedFields).toBe('bank,account,transId')
    expect(verifies).toBe(true)
  })

  it('lipa: sends network as an EMPTY STRING when absent (vendor demo body shape)', () => {
    const fields = buildLipaFields({ payNumber: '123456', amountTzs: 500 }, 't-lipa-2')
    expect(fields.map((f) => f.name)).toEqual(['transId', 'payNumber', 'network', 'amount'])
    expect(fields.find((f) => f.name === 'network')?.value).toBe('')
    const { verifies, signedFields } = signingStringFor(fields)
    expect(signedFields).toBe('transId,payNumber,network,amount')
    expect(verifies).toBe(true)
  })
})

describe('detectWalletFiCode (prefix → Selcom FI code)', () => {
  it('maps every routable network and fails loudly on unmapped prefixes', () => {
    // Canonical portal table (docs/psp/selcom-destination-shortcodes.md).
    // MPESA proven by live dispatch 1 Aug 2026; the VMCASHIN-style codes the
    // adapter originally shipped answered 651 invalid/inactive.
    expect(detectWalletFiCode(normalizePhone('0744277496'))).toBe('MPESA') // Vodacom
    expect(detectWalletFiCode(normalizePhone('0689000000'))).toBe('AIRTELMONEY') // Airtel
    expect(detectWalletFiCode(normalizePhone('0714641171'))).toBe('MIXXBYYAS') // Mixx by Yas
    expect(detectWalletFiCode(normalizePhone('0612345678'))).toBe('HALOPESA') // Halotel
    expect(detectWalletFiCode(normalizePhone('0731234567'))).toBe('TTCLPESA') // TTCL
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
    // 1 Aug 2026: a live 5,000 TZS withdrawal was quoted Snippe's 1,500 while
    // Selcom served it at this tier fee — the pin behind per-rail pricing.
    expect(getPayoutFeeTzs('selcom', 5_000)).toBe(150)
  })
})

/**
 * Banking phase 1 (3 Aug 2026): bank FI codes carry the same rule the wallet
 * codes taught on 1 Aug — transcribed codes are claims, not facts, until one
 * live probe settles. These pin the canonical registry and the probe surface.
 */
describe('bank FI codes and the bank probe', () => {
  it('the registry matches the canonical shortcode table', () => {
    expect(Object.keys(BANK_FI_CODES).length).toBeGreaterThanOrEqual(35)
    // The two known quirks, straight from the portal capture:
    expect(BANK_FI_CODES.CRDB).toEqual({ name: 'CRDB Bank', reference: 'alphanumeric', lookup: true })
    expect(BANK_FI_CODES.BOT?.lookup).toBe(false)
    // Big-four sanity.
    for (const code of ['NMB', 'NBC', 'CRDB', 'STANBIC']) expect(BANK_FI_CODES[code]).toBeDefined()
    // Wallet codes must never leak into the bank registry.
    expect(BANK_FI_CODES).not.toHaveProperty('MPESA')
    // CRDB is the ONLY alphanumeric reference.
    const alnum = Object.entries(BANK_FI_CODES).filter(([, b]) => b.reference === 'alphanumeric')
    expect(alnum.map(([c]) => c)).toEqual(['CRDB'])
  })

  it('the spend-test route gates, caps and validates the bank kind', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../app/api/admin/selcom-spend-test/route.ts'),
      'utf8',
    )
    expect(src).toContain("kind !== 'bank'")
    // Banks ride the disbursement rail's gate, like wallet payouts.
    expect(src).toContain("kind === 'wallet' || kind === 'bank'")
    expect(src).toContain('SELCOM_DISBURSEMENTS_ENABLED')
    // Codes come from the canonical registry, never free text.
    expect(src).toContain('BANK_FI_CODES[bankCode]')
    // The 5,000 TZS probe cap is one constant for every kind.
    expect(src).toContain('MAX_TEST_AMOUNT_TZS = 5000')
  })
})

/**
 * The LUKU probe (30 Jul 2026) established that biller validation is
 * AMOUNT-AWARE: with no amount, bank=LUKU answers 651 "The minimum amount is
 * 1,000." while a genuinely wrong code answers "Invalid or inactive bank/FI
 * code". These pin the request shape so the field can neither vanish nor leak
 * into the wallet/till lookups that work without it.
 */
describe('buildNedaLookupFields (biller lookups carry the amount)', () => {
  it('appends amount for a biller lookup, after the collection-order fields', () => {
    const fields = buildNedaLookupFields('LUKU', '24219217817', 'T123', 1000)
    expect(fields.map((f) => f.name)).toEqual(['bank', 'account', 'transId', 'amount'])
    expect(fields[3].value).toBe(1000)
  })

  it('truncates a fractional amount — Selcom prices whole shillings', () => {
    const fields = buildNedaLookupFields('LUKU', '24219217817', 'T123', 1500.75)
    expect(fields[3].value).toBe(1500)
  })

  it('omits the field entirely when no amount is given (wallet/till lookups)', () => {
    for (const amount of [undefined, 0, -5, NaN]) {
      const fields = buildNedaLookupFields('SB2LIPA', '61115582', 'T123', amount as number | undefined)
      expect(fields.map((f) => f.name)).toEqual(['bank', 'account', 'transId'])
    }
  })

  it('signs exactly the fields sent, amount included', () => {
    const fields = buildNedaLookupFields('LUKU', '24219217817', 'T9', 1000)
    const { headers, body } = signRequest(fields)
    expect(headers['signed-fields']).toBe('bank,account,transId,amount')
    expect(body).toEqual({ bank: 'LUKU', account: '24219217817', transId: 'T9', amount: 1000 })
  })
})

/**
 * The biller timeout and the routes' declared durations must move together:
 * a 25s lookup inside a route on the platform default duration dies with the
 * route, and the caller sees a 504 instead of a fail-soft null name. Source
 * assertions, same style as the sandbox coverage tests.
 */
describe('biller lookups get a utility-sized budget, and their routes outlive it', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')

  it('nedaAccountLookup branches the timeout on the amount', () => {
    const src = fs.readFileSync(path.join(__dirname, 'selcom.ts'), 'utf8')
    expect(src).toContain("opts?.amountTzs != null ? 25_000 : 8_000")
    expect(src).toContain('AbortSignal.timeout(timeoutMs)')
  })

  it('every route that resolves biller names declares maxDuration ≥ 60', () => {
    for (const rel of [
      '../../app/api/v1/spend/quote/route.ts',
      '../../app/api/v1/ramp/quote/route.ts',
      '../../app/api/v1/lookup/merchant-name/route.ts',
    ]) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8')
      expect(src, `${rel} must declare maxDuration`).toMatch(/export const maxDuration = 60/)
    }
  })
})
