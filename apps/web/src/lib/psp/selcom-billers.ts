/**
 * Selcom bill-pay biller catalogue — transcribed from "SB Biller Codes.pdf"
 * (Dhimant, 25 Jul 2026). Source of truth for which utilityCode values
 * neda-bill-pay accepts and what each biller's reference must look like.
 *
 * ⚠ The PDF lists the airtime code as TOP while the Postman collection's
 * example request used ATOP — the first live airtime test settles which one
 * the gateway actually accepts (an invalid code fails fast and harmlessly).
 * ⚠ Fees per biller are still pending from Selcom.
 *
 * ⚠ LENGTH BOUNDS ARE TRANSCRIBED, NOT PROVEN, and the two failure directions
 * are not symmetric:
 *
 *   too STRICT — we refuse a reference Selcom would have accepted. The customer
 *                cannot pay, sees our error, and nothing reaches the gateway to
 *                tell us we were wrong. Silent and customer-facing.
 *   too LOOSE  — Selcom refuses it and says so. Recoverable, and it teaches us.
 *
 * So an unverified exact length is the dangerous shape, and passing ONE bound
 * to b() means exactly that length. DSTV was defined that way and blocked real
 * 10-digit smartcards until 6 Aug 2026. Where the true range is unknown, prefer
 * the wider bound or omit bounds entirely and let the gateway adjudicate.
 *
 * Rejections are logged (code + observed length, never the reference itself —
 * a meter or smartcard number is customer data), so production reports a wrong
 * bound instead of a customer having to.
 */

export type BillerCategory = 'utility' | 'tv' | 'internet' | 'government' | 'travel'

export interface SelcomBiller {
  code: string
  category: BillerCategory
  /** What Selcom calls the reference on their side, shown to the payer. */
  refLabel: string
  refKind: 'numeric' | 'alphanumeric'
  /** Inclusive length bounds where the PDF specifies them. */
  refMin?: number
  refMax?: number
}

const b = (
  code: string,
  category: BillerCategory,
  refLabel: string,
  refKind: 'numeric' | 'alphanumeric',
  refMin?: number,
  refMax?: number
): SelcomBiller => ({ code, category, refLabel, refKind, refMin, refMax: refMax ?? refMin })

export const SELCOM_BILLERS: SelcomBiller[] = [
  // Utility services
  b('TOP', 'utility', 'Mobile No', 'numeric', 10, 12),
  b('LUKU', 'utility', 'Meter No', 'numeric', 11),
  b('TUKUZA', 'utility', 'Meter No', 'numeric', 11, 16),
  b('ECOWATER', 'utility', 'Account Number', 'numeric'),
  b('AMVERTON', 'utility', 'Account Number', 'numeric'),
  b('DAWASA', 'utility', 'Control Number', 'numeric', 12, 20),
  b('NHC', 'utility', 'Control Number', 'numeric', 12, 20),
  b('BETAMAX', 'utility', 'Meter Number', 'numeric', 11),
  b('HIGHLAND', 'utility', 'Meter Number', 'numeric', 11),
  b('THORNLUX', 'utility', 'Meter Number', 'numeric', 11),
  // TV subscriptions
  // 10–11, not exactly 11. The PDF gave one length; a real 10-digit smartcard
  // was rejected in testing on 6 Aug 2026. Field evidence outranks the PDF.
  b('DSTV', 'tv', 'Smartcard No', 'numeric', 10, 11),
  b('ZMUX', 'tv', 'Smartcard No', 'numeric', 16),
  b('AZAMTV', 'tv', 'Smartcard No', 'numeric', 12),
  b('STARTIMES', 'tv', 'Customer ID or Smartcard No', 'numeric', 10, 11),
  b('ZUKU', 'tv', 'Account No', 'numeric', 6),
  b('AZAMTVAPP', 'tv', 'Mobile Number', 'numeric', 10, 12),
  // Prepaid internet
  b('SMILE', 'internet', 'Account No', 'numeric', 10),
  b('ZUKUFIBER', 'internet', 'Account No', 'numeric', 6),
  b('TTCL', 'internet', 'Mobile No', 'numeric', 10),
  b('GOFIBER', 'internet', 'Account Number', 'numeric'),
  b('ZESHA', 'internet', 'Account Number', 'numeric'),
  // Government payments
  b('GEPG', 'government', 'Control No', 'numeric', 12),
  b('ZANMALIPO', 'government', 'Control No', 'numeric', 12),
  b('TRAFFICFINE', 'government', 'Control No', 'numeric', 12),
  b('TARURA', 'government', 'Vehicle Number', 'alphanumeric', 3, 15),
  b('WATERBILLS', 'government', 'Control No', 'numeric', 12),
  b('TRAGEPG', 'government', 'Control No', 'numeric', 12),
  // Travel & ticket booking
  b('COASTAL', 'travel', 'Booking Ref', 'numeric', 8),
  b('AURIC', 'travel', 'Booking Ref', 'numeric', 6),
  b('ATCL', 'travel', 'Booking Ref', 'alphanumeric', 6, 10),
]

export const BILLER_CATEGORY_LABELS: Record<BillerCategory, string> = {
  utility: 'Utilities (power, water, airtime)',
  tv: 'TV subscriptions',
  internet: 'Prepaid internet',
  government: 'Government payments',
  travel: 'Travel & tickets',
}

export function getBiller(code: string): SelcomBiller | undefined {
  return SELCOM_BILLERS.find((x) => x.code === code.trim().toUpperCase())
}

/**
 * Validate a utility reference against the catalogue's charset + length spec.
 * Unknown codes validate as ok (nothing to check against) — the PRODUCT layer
 * must separately require getBiller() to hit; this helper only prevents
 * obviously-malformed references from reaching the gateway.
 */
export function validateUtilityRef(code: string, ref: string): { ok: boolean; reason?: string } {
  const biller = getBiller(code)
  if (!biller) return { ok: true }

  const value = ref.trim()
  if (!value) return { ok: false, reason: `${biller.refLabel} is required` }

  const charsetOk = biller.refKind === 'numeric' ? /^\d+$/.test(value) : /^[A-Za-z0-9]+$/.test(value)
  if (!charsetOk) {
    return { ok: false, reason: `${biller.refLabel} must be ${biller.refKind === 'numeric' ? 'digits only' : 'letters and digits only'}` }
  }

  if (
    (biller.refMin != null && value.length < biller.refMin) ||
    (biller.refMax != null && value.length > biller.refMax)
  ) {
    // A length rejection is the one outcome that can be OUR error rather than
    // the payer's: these bounds were transcribed from a PDF, and a too-strict
    // one blocks a payment the gateway would have taken. Logged so a wrong
    // bound surfaces in our own logs rather than as a support ticket. The
    // length only — the reference itself is customer data.
    console.warn(
      `[selcom-billers] reference length rejected: code=${biller.code} observed=${value.length} allowed=${biller.refMin}-${biller.refMax}`
    )
    return { ok: false, reason: lengthHint(biller) }
  }
  return { ok: true }
}

export function lengthHint(biller: SelcomBiller): string {
  if (biller.refMin == null) return `${biller.refLabel} (${biller.refKind})`
  return biller.refMin === biller.refMax
    ? `${biller.refLabel} must be exactly ${biller.refMin} ${biller.refKind === 'numeric' ? 'digits' : 'characters'}`
    : `${biller.refLabel} must be ${biller.refMin}–${biller.refMax} ${biller.refKind === 'numeric' ? 'digits' : 'characters'}`
}
