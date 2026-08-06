/**
 * Merchant-presented QR decoding (EMVCo MPM — the standard TANQR is built on).
 *
 * A customer points a camera at a sticker on a counter and gets back a string
 * like `00020101021126…6304A13F`. That string is not a URL and not a till
 * number: it is EMVCo Merchant-Presented Mode, a flat TLV list where every
 * field is `TT LL VALUE` — two digits of tag, two digits of length, then
 * exactly that many characters. Nested templates use the same encoding inside
 * their value.
 *
 * WHAT THIS MODULE IS SURE ABOUT, AND WHAT IT IS NOT
 *
 * The envelope is published and unambiguous: the tags below, and a CRC-16
 * checksum over the whole payload, are the same everywhere EMVCo MPM is used.
 * Those are decoded and verified here.
 *
 * Where the *merchant identifier* sits is not. EMVCo reserves tags 26–51 for
 * domestic schemes to define as they wish, so the Lipa Namba's exact position
 * inside a TANQR code is a property of the Tanzanian scheme, not of the
 * standard. Rather than guess a tag — which would silently mis-read real
 * merchant codes and could pay the wrong till — this module extracts every
 * plausible identifier it finds and leaves the choice to the caller, who
 * settles it by asking the acquirer which one resolves to a real merchant.
 * Guessing is the one thing a payment decoder must not do.
 */

/** ISO 4217 numeric for the Tanzanian Shilling. */
export const TZS_CURRENCY_NUMERIC = '834'

/** EMVCo caps the QR data at 512 characters; anything longer is not one. */
const MAX_PAYLOAD_LENGTH = 512

const TAG_FORMAT_INDICATOR = '00'
const TAG_INITIATION_METHOD = '01'
const TAG_MCC = '52'
const TAG_CURRENCY = '53'
const TAG_AMOUNT = '54'
const TAG_COUNTRY = '58'
const TAG_MERCHANT_NAME = '59'
const TAG_MERCHANT_CITY = '60'
const TAG_ADDITIONAL_DATA = '62'
const TAG_CRC = '63'

/** Sub-tags inside the additional-data template (62). */
const SUB_BILL_NUMBER = '01'
const SUB_REFERENCE_LABEL = '05'

/** A Lipa Namba, matching what /v1/lookup/merchant-name and the quote accept. */
const TILL_NUMBER_RE = /^\d{4,12}$/

/**
 * Schemes whose layout we have READ OFF A REAL CODE, not inferred.
 *
 * TANQR carries the GUID `tz.go.bot.tips` — the Bank of Tanzania's Instant
 * Payment System. Decoded from a live merchant sticker on 6 Aug 2026
 * (THE DECK AND KITCHEN BAR, Dar es Salaam):
 *
 *   26  0014 tz.go.bot.tips     ← scheme
 *       0105 02504              ← acquirer / PSP institution code
 *       0209 138974122          ← THE MERCHANT'S LIPA NAMBA
 *   62  0309 138974122          ← store label, repeating the same till
 *
 * Selcom settled which is which from evidence rather than assumption: `02504`
 * came back "unable to detect network provider", `138974122` came back
 * "THE DECK KITCHEN AND BAR". The store label in tag 62 corroborates it
 * independently.
 *
 * Knowing this turns a two-call search into one lookup, stops us asking the
 * acquirer about an institution code that can never resolve, and — the part
 * that matters — removes the chance of calling a code ambiguous because two of
 * its values happened to look like tills.
 *
 * The mapping is a fast path, never a hard dependency: `candidateTillNumbers`
 * still carries every value, so if the scheme's layout ever changes the search
 * fallback continues to find the merchant.
 */
const KNOWN_SCHEMES: Record<string, { merchantSubTag: string; acquirerSubTag: string; label: string }> = {
  'tz.go.bot.tips': {
    merchantSubTag: '02',
    acquirerSubTag: '01',
    label: 'TIPS — Tanzania Instant Payment System (TANQR)',
  },
}

export interface QrMerchantAccount {
  /** The template tag it was found under (26–51 are scheme-defined). */
  tag: string
  /** Sub-tag 00 by convention: the scheme's globally unique identifier. */
  guid: string | null
  /** Every other sub-value, in sub-tag order. */
  values: string[]
  /** Sub-values keyed by sub-tag, so a known scheme can address them by name. */
  fields?: Record<string, string>
}

export interface DecodedMerchantQr {
  /** True when the QR encodes a specific amount (EMVCo point-of-initiation 12). */
  dynamic: boolean
  merchantName: string | null
  merchantCity: string | null
  countryCode: string | null
  currencyNumeric: string | null
  /** Only populated when the currency is TZS — we will not infer a shilling amount from another currency. */
  amountTzs: number | null
  merchantCategoryCode: string | null
  /** Invoice / reference the merchant attached to the code, if any. */
  reference: string | null
  accounts: QrMerchantAccount[]
  /**
   * Numeric values that could be the merchant's Lipa Namba, in the order they
   * are worth trying. A candidate is a guess until the acquirer confirms it.
   */
  candidateTillNumbers: string[]
  /** The scheme GUID, when it is one whose layout we have read off a real code. */
  scheme: string | null
  /** Human label for that scheme. */
  schemeLabel: string | null
  /**
   * The value the KNOWN scheme designates as the merchant's till — the fast
   * path. Null for an unrecognised scheme, where the candidate search decides.
   */
  merchantIdentifier: string | null
  /** The acquirer/institution code. Never the merchant, and never resolves. */
  acquirerIdentifier: string | null
}

export type QrDecodeResult =
  | { ok: true; value: DecodedMerchantQr }
  | { ok: false; code: QrDecodeErrorCode; error: string }

export type QrDecodeErrorCode =
  | 'not_a_merchant_qr'
  | 'malformed_payload'
  | 'checksum_failed'
  | 'payload_too_long'

/**
 * CRC-16/CCITT-FALSE — polynomial 0x1021, initial value 0xFFFF, no reflection,
 * no final XOR. This exact variant is what EMVCo specifies; the other CRC-16
 * flavours produce different digits and would reject every genuine code.
 */
export function crc16CcittFalse(input: string): number {
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc ^= (input.charCodeAt(i) & 0xff) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

interface Tlv {
  tag: string
  value: string
}

/** Flat TLV parse. Returns null on anything that is not exactly well-formed —
 *  a partial parse of a payment instruction is worse than no parse. */
function parseTlv(input: string): Tlv[] | null {
  const out: Tlv[] = []
  let i = 0
  while (i < input.length) {
    if (i + 4 > input.length) return null
    const tag = input.slice(i, i + 2)
    const lengthDigits = input.slice(i + 2, i + 4)
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthDigits)) return null
    const length = Number(lengthDigits)
    const start = i + 4
    const end = start + length
    if (end > input.length) return null
    out.push({ tag, value: input.slice(start, end) })
    i = end
  }
  return out.length > 0 ? out : null
}

function findValue(fields: Tlv[], tag: string): string | null {
  const hit = fields.find((f) => f.tag === tag)
  return hit ? hit.value : null
}

export function decodeMerchantQr(payload: string): QrDecodeResult {
  const raw = (payload ?? '').trim()

  if (!raw) {
    return { ok: false, code: 'not_a_merchant_qr', error: 'Empty QR payload.' }
  }
  if (raw.length > MAX_PAYLOAD_LENGTH) {
    return {
      ok: false,
      code: 'payload_too_long',
      error: `QR payload exceeds the ${MAX_PAYLOAD_LENGTH}-character EMVCo limit — this is not a merchant-presented QR.`,
    }
  }
  // A URL, a wallet address or a deep link is a legitimate thing to find in a
  // QR; it is simply not this. Say so precisely so the client can route it.
  if (!raw.startsWith('000201')) {
    return {
      ok: false,
      code: 'not_a_merchant_qr',
      error:
        'Not a merchant-presented (EMVCo) QR — it does not begin with the payload format indicator 000201. If it looks like a URL or deep link, handle it in your app.',
    }
  }

  const crcIndex = raw.lastIndexOf(`${TAG_CRC}04`)
  if (crcIndex < 0 || crcIndex + 8 !== raw.length) {
    return {
      ok: false,
      code: 'malformed_payload',
      error: 'Missing or misplaced CRC field (63) — it must be the final field of the payload.',
    }
  }

  // The checksum covers everything up to AND INCLUDING the CRC tag and length.
  const checksumOver = raw.slice(0, crcIndex + 4)
  const declared = raw.slice(crcIndex + 4).toUpperCase()
  if (!/^[0-9A-F]{4}$/.test(declared)) {
    return { ok: false, code: 'malformed_payload', error: 'CRC field is not four hexadecimal characters.' }
  }
  const computed = crc16CcittFalse(checksumOver).toString(16).toUpperCase().padStart(4, '0')
  if (computed !== declared) {
    return {
      ok: false,
      code: 'checksum_failed',
      error:
        'QR checksum does not match its contents. The code is damaged, was mis-scanned, or has been altered — do not pay against it.',
    }
  }

  const fields = parseTlv(raw)
  if (!fields) {
    return { ok: false, code: 'malformed_payload', error: 'QR payload is not valid TLV — a field length overruns the data.' }
  }
  if (findValue(fields, TAG_FORMAT_INDICATOR) !== '01') {
    return { ok: false, code: 'not_a_merchant_qr', error: 'Unsupported payload format indicator.' }
  }

  // ── Merchant account templates ──────────────────────────────────────────
  // 02–25 carry a plain identifier for a well-known scheme; 26–51 are nested
  // templates a domestic scheme defines for itself.
  const accounts: QrMerchantAccount[] = []
  const candidates: string[] = []
  let scheme: string | null = null
  let schemeLabel: string | null = null
  let merchantIdentifier: string | null = null
  let acquirerIdentifier: string | null = null

  const pushCandidate = (v: string) => {
    const trimmed = v.trim()
    if (TILL_NUMBER_RE.test(trimmed) && !candidates.includes(trimmed)) candidates.push(trimmed)
  }

  for (const field of fields) {
    const tagNumber = Number(field.tag)
    if (!Number.isInteger(tagNumber) || tagNumber < 2 || tagNumber > 51) continue

    if (tagNumber <= 25) {
      accounts.push({ tag: field.tag, guid: null, values: [field.value] })
      pushCandidate(field.value)
      continue
    }

    const sub = parseTlv(field.value)
    if (!sub) {
      // A template we cannot parse is not fatal — the rest of the code may
      // still identify the merchant — but its contents are not usable.
      accounts.push({ tag: field.tag, guid: null, values: [] })
      continue
    }
    const guid = sub.find((s) => s.tag === '00')?.value ?? null
    const rest = sub.filter((s) => s.tag !== '00')
    const fieldsBySubTag: Record<string, string> = {}
    for (const s of rest) fieldsBySubTag[s.tag] = s.value
    accounts.push({ tag: field.tag, guid, values: rest.map((s) => s.value), fields: fieldsBySubTag })

    const known = guid ? KNOWN_SCHEMES[guid] : undefined
    if (known && !scheme) {
      scheme = guid
      schemeLabel = known.label
      const designated = fieldsBySubTag[known.merchantSubTag]?.trim()
      if (designated && TILL_NUMBER_RE.test(designated)) merchantIdentifier = designated
      const acquirer = fieldsBySubTag[known.acquirerSubTag]?.trim()
      if (acquirer) acquirerIdentifier = acquirer
    }

    for (const s of rest) pushCandidate(s.value)
  }

  // Order the search so the value the scheme designates is tried first, and the
  // acquirer code — which we know can never resolve to a merchant — is tried
  // last rather than dropped, so an unannounced change to the scheme's layout
  // degrades into a slower search instead of a hard failure.
  if (merchantIdentifier || acquirerIdentifier) {
    const rank = (v: string) => (v === merchantIdentifier ? 0 : v === acquirerIdentifier ? 2 : 1)
    candidates.sort((a, b) => rank(a) - rank(b))
  }

  const currencyNumeric = findValue(fields, TAG_CURRENCY)
  const amountRaw = findValue(fields, TAG_AMOUNT)
  let amountTzs: number | null = null
  if (amountRaw && currencyNumeric === TZS_CURRENCY_NUMERIC) {
    const parsed = Number(amountRaw)
    if (Number.isFinite(parsed) && parsed > 0) amountTzs = Math.round(parsed)
  }

  const additional = findValue(fields, TAG_ADDITIONAL_DATA)
  let reference: string | null = null
  if (additional) {
    const sub = parseTlv(additional)
    if (sub) {
      reference =
        sub.find((s) => s.tag === SUB_REFERENCE_LABEL)?.value ??
        sub.find((s) => s.tag === SUB_BILL_NUMBER)?.value ??
        null
    }
  }

  return {
    ok: true,
    value: {
      dynamic: findValue(fields, TAG_INITIATION_METHOD) === '12',
      merchantName: findValue(fields, TAG_MERCHANT_NAME),
      merchantCity: findValue(fields, TAG_MERCHANT_CITY),
      countryCode: findValue(fields, TAG_COUNTRY),
      currencyNumeric,
      amountTzs,
      merchantCategoryCode: findValue(fields, TAG_MCC),
      reference,
      accounts,
      candidateTillNumbers: candidates,
      scheme,
      schemeLabel,
      merchantIdentifier,
      acquirerIdentifier,
    },
  }
}

/**
 * Encode a TLV run. Nested templates are built by encoding their sub-fields
 * with this and passing the result as a value.
 *
 * Exported because hand-writing lengths is a genuine trap — an off-by-one in a
 * declared length produces a string that looks right and decodes to something
 * else entirely, which is exactly the bug class this module exists to refuse.
 */
export function encodeTlv(fields: Array<[string, string]>): string {
  return fields.map(([tag, value]) => `${tag}${String(value.length).padStart(2, '0')}${value}`).join('')
}

/**
 * Build a complete EMVCo payload with its checksum. Used by the tests to
 * construct genuine codes rather than hand-copied strings, and available to
 * anything that needs to emit one.
 */
export function encodeMerchantQr(fields: Array<[string, string]>): string {
  const withCrcTag = `${encodeTlv(fields)}${TAG_CRC}04`
  return `${withCrcTag}${crc16CcittFalse(withCrcTag).toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Do the name on the sticker and the name the acquirer holds describe the same
 * business?
 *
 * The dominant fraud against merchant-presented QR is physical: a sticker
 * pasted over the real one, so the customer sees the right shop and pays the
 * wrong account. The QR's own merchant name is attacker-controlled and the
 * acquirer's is not, so a disagreement between them is worth surfacing —
 * loudly enough to stop a customer, not so eagerly that ordinary abbreviation
 * ("KARIAKOO HARDWARE" vs "KARIAKOO HARDWARE LIMITED") cries wolf.
 *
 * Returns null when there is nothing to compare.
 */
export function qrNameAgrees(qrName: string | null, resolvedName: string | null): boolean | null {
  if (!qrName || !resolvedName) return null

  const normalize = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      // Corporate suffixes carry no identifying information and are exactly
      // where the two sources routinely differ.
      .filter((t) => !['LTD', 'LIMITED', 'CO', 'COMPANY', 'PLC', 'ENTERPRISES', 'ENTERPRISE', 'T', 'A'].includes(t))

  const qrTokens = normalize(qrName)
  const resolvedTokens = new Set(normalize(resolvedName))
  if (qrTokens.length === 0 || resolvedTokens.size === 0) return null

  const shared = qrTokens.filter((t) => resolvedTokens.has(t)).length
  // One shared word is a coincidence in a country full of "DUKA LA…"; a
  // majority of the shorter name is the same business.
  return shared >= Math.max(1, Math.ceil(Math.min(qrTokens.length, resolvedTokens.size) / 2))
}
