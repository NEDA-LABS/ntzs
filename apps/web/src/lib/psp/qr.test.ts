import { describe, it, expect } from 'vitest'

import {
  TZS_CURRENCY_NUMERIC,
  crc16CcittFalse,
  decodeMerchantQr,
  encodeMerchantQr,
  encodeTlv,
  qrNameAgrees,
} from './qr'

/**
 * A QR decoder sits directly in front of a payment. The failures that matter
 * are not "it didn't parse" — they are "it parsed into the wrong till". These
 * tests are about refusing to be confidently wrong.
 */

/** A scheme template: the GUID, then the merchant's identifier. */
const tanqrAccount = (till: string, extra: Array<[string, string]> = []) =>
  encodeTlv([['00', 'tz.go.bot.tanqr'], ['01', till], ...extra])

const staticQr = encodeMerchantQr([
  ['00', '01'],
  ['01', '11'],
  ['26', tanqrAccount('123456')],
  ['52', '5311'],
  ['53', TZS_CURRENCY_NUMERIC],
  ['58', 'TZ'],
  ['59', 'KARIAKOO HARDWARE'],
  ['60', 'DAR ES SALAAM'],
])

const dynamicQr = encodeMerchantQr([
  ['00', '01'],
  ['01', '12'],
  ['26', tanqrAccount('778899')],
  ['53', TZS_CURRENCY_NUMERIC],
  ['54', '5000'],
  ['58', 'TZ'],
  ['59', 'MAMA NTILIE CAFE'],
  ['62', '0509INV-00931'],
])

describe('the checksum', () => {
  it('matches the published CRC-16/CCITT-FALSE check value', () => {
    // The standard test vector for this variant: "123456789" → 0x29B1.
    // Getting this wrong (a reflected variant, a different init) rejects every
    // genuine code in the country, so it is pinned to the spec, not to us.
    expect(crc16CcittFalse('123456789')).toBe(0x29b1)
  })

  it('rejects a payload whose contents were altered after it was signed', () => {
    // Repoint the till from 123456 to 999999 and leave the CRC untouched —
    // precisely what tampering with a printed code looks like.
    const tampered = staticQr.replace('123456', '999999')
    const result = decodeMerchantQr(tampered)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('checksum_failed')
    expect(result.error).toContain('do not pay')
  })
})

describe('decoding a genuine code', () => {
  it('reads a static merchant QR', () => {
    const result = decodeMerchantQr(staticQr)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.merchantName).toBe('KARIAKOO HARDWARE')
    expect(result.value.merchantCity).toBe('DAR ES SALAAM')
    expect(result.value.countryCode).toBe('TZ')
    expect(result.value.dynamic).toBe(false)
    expect(result.value.amountTzs).toBeNull()
    expect(result.value.candidateTillNumbers).toContain('123456')
  })

  it('reads a dynamic QR with its amount and reference', () => {
    const result = decodeMerchantQr(dynamicQr)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dynamic).toBe(true)
    expect(result.value.amountTzs).toBe(5000)
    expect(result.value.reference).toBe('INV-00931')
    expect(result.value.candidateTillNumbers).toContain('778899')
  })

  it('exposes the scheme GUID rather than assuming which scheme it is', () => {
    const result = decodeMerchantQr(staticQr)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const account = result.value.accounts.find((a) => a.tag === '26')
    expect(account?.guid).toBe('tz.go.bot.tanqr')
  })

  it('never reports a shilling amount for a code priced in another currency', () => {
    const foreign = encodeMerchantQr([
      ['00', '01'],
      ['01', '12'],
      ['26', tanqrAccount('123456')],
      ['53', '840'], // USD
      ['54', '25'],
      ['58', 'TZ'],
      ['59', 'SOMEWHERE'],
    ])
    const result = decodeMerchantQr(foreign)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 25 dollars must never be presented to a user as 25 shillings.
    expect(result.value.amountTzs).toBeNull()
    expect(result.value.currencyNumeric).toBe('840')
  })
})

describe('things that are not a merchant QR', () => {
  it('tells the caller plainly when it scanned a URL', () => {
    const result = decodeMerchantQr('https://ntzs.co.tz/pay/abc123')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('not_a_merchant_qr')
    expect(result.error).toContain('URL')
  })

  it('rejects an empty scan', () => {
    expect(decodeMerchantQr('').ok).toBe(false)
  })

  it('rejects a truncated payload rather than half-reading it', () => {
    // Cut the middle out: the CRC tag survives but a field now overruns.
    const truncated = staticQr.slice(0, 20) + staticQr.slice(-8)
    const result = decodeMerchantQr(truncated)
    expect(result.ok).toBe(false)
  })

  it('rejects a field whose declared length runs past the end of the data', () => {
    const overrun = encodeMerchantQr([['00', '01'], ['59', 'SHOP']]).replace('5904SHOP', '5999SHOP')
    const result = decodeMerchantQr(overrun)
    expect(result.ok).toBe(false)
    if (result.ok) return
    // Either the checksum or the TLV walk catches it; both are correct refusals.
    expect(['malformed_payload', 'checksum_failed']).toContain(result.code)
  })

  it('refuses a payload longer than the EMVCo limit instead of chewing on it', () => {
    const result = decodeMerchantQr('000201' + 'x'.repeat(600))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('payload_too_long')
  })
})

describe('the till number is a candidate, not a conclusion', () => {
  it('collects every plausible identifier when a code carries several', () => {
    const multi = encodeMerchantQr([
      ['00', '01'],
      ['01', '11'],
      ['26', tanqrAccount('123456', [['02', '99887766']])],
      ['53', TZS_CURRENCY_NUMERIC],
      ['58', 'TZ'],
      ['59', 'TWO IDS'],
    ])
    const result = decodeMerchantQr(multi)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Both are offered. Picking one without confirming it is the caller's
    // decision to make carefully, not ours to make silently.
    expect(result.value.candidateTillNumbers).toEqual(['123456', '99887766'])
  })

  it('ignores values that cannot be a Lipa Namba', () => {
    const result = decodeMerchantQr(staticQr)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The scheme GUID and the city are not till numbers.
    expect(result.value.candidateTillNumbers).not.toContain('tz.go.bot.tanqr')
    expect(result.value.candidateTillNumbers.every((c) => /^\d{4,12}$/.test(c))).toBe(true)
  })
})

describe('sticker-swap detection', () => {
  it('accepts ordinary variation in how a business writes its own name', () => {
    expect(qrNameAgrees('KARIAKOO HARDWARE', 'KARIAKOO HARDWARE LIMITED')).toBe(true)
    expect(qrNameAgrees('Mama Ntilie Cafe', 'MAMA NTILIE CAFE LTD')).toBe(true)
  })

  it('flags a code whose printed name has nothing to do with the account behind it', () => {
    // The overlay attack: the sticker says the shop you are standing in, the
    // account belongs to somebody else entirely.
    expect(qrNameAgrees('KARIAKOO HARDWARE', 'JOHN MTEMBEI GENERAL SUPPLIES')).toBe(false)
  })

  it('says nothing rather than guessing when there is nothing to compare', () => {
    expect(qrNameAgrees(null, 'KARIAKOO HARDWARE')).toBeNull()
    expect(qrNameAgrees('KARIAKOO HARDWARE', null)).toBeNull()
    expect(qrNameAgrees('LTD', 'LIMITED')).toBeNull()
  })
})

describe('a real TANQR code from the field', () => {
  /**
   * Scanned 6 Aug 2026 from a live merchant sticker (THE DECK AND KITCHEN BAR,
   * Dar es Salaam) via Backstage → Selcom Test → Scan to pay.
   *
   * This fixture is the whole reason the decoder can stop searching. Everything
   * below was previously inferred; it is now read off a genuine code.
   */
  const REAL =
    '00020101021126400014tz.go.bot.tips01050250402091389741225204000053038345802TZ5924THE DECK AND KITCHEN BAR6008TANZANIA610514110621303091389741226304F3ED'

  const result = decodeMerchantQr(REAL)

  it('passes its own checksum — our CRC implementation is right for real codes', () => {
    expect(result.ok, 'a genuine merchant code must decode').toBe(true)
  })

  it('reads the merchant and the scheme', () => {
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.merchantName).toBe('THE DECK AND KITCHEN BAR')
    expect(result.value.countryCode).toBe('TZ')
    expect(result.value.currencyNumeric).toBe(TZS_CURRENCY_NUMERIC)
    expect(result.value.dynamic).toBe(false)
    expect(result.value.amountTzs).toBeNull()
    expect(result.value.scheme).toBe('tz.go.bot.tips')
  })

  it('picks the MERCHANT till, not the acquirer code', () => {
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Selcom's verdict on this exact code: 02504 → "unable to detect network
    // provider"; 138974122 → "THE DECK KITCHEN AND BAR". Tag 62's store label
    // repeats 138974122, corroborating it independently.
    expect(result.value.merchantIdentifier).toBe('138974122')
    expect(result.value.acquirerIdentifier).toBe('02504')
  })

  it('tries the merchant till first and the acquirer code last', () => {
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Ordering is what removes a guaranteed-to-fail upstream call on every
    // scan, and with it a misleading error in the logs.
    expect(result.value.candidateTillNumbers[0]).toBe('138974122')
    expect(result.value.candidateTillNumbers.at(-1)).toBe('02504')
  })

  it('still offers the acquirer code as a fallback rather than dropping it', () => {
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // If BoT ever moves the till to another sub-tag, the search must still be
    // able to find it — a known layout is a fast path, never a dependency.
    expect(result.value.candidateTillNumbers).toContain('02504')
  })

  it('accepts the acquirer’s word order for the same business', () => {
    // The QR says "THE DECK AND KITCHEN BAR"; Selcom's register says
    // "THE DECK KITCHEN AND BAR". Same business, words reordered — this must
    // not fire the swapped-sticker warning at a real customer.
    expect(qrNameAgrees('THE DECK AND KITCHEN BAR', 'THE DECK KITCHEN AND BAR')).toBe(true)
  })
})

describe('round trip', () => {
  it('encodes what it decodes', () => {
    const built = encodeMerchantQr([
      ['00', '01'],
      ['01', '11'],
      ['53', TZS_CURRENCY_NUMERIC],
      ['58', 'TZ'],
      ['59', 'ROUND TRIP'],
    ])
    const result = decodeMerchantQr(built)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.merchantName).toBe('ROUND TRIP')
  })
})
