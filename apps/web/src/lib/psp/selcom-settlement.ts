/**
 * Reading Selcom's settlement payload.
 *
 * ⚠ WHY THIS MODULE EXISTS. Two consumers independently read the settled
 * transaction with the WRONG KEY NAMES — `d.totalCharges` and `d.selcomReceipt`
 * against a payload that sends `total_charges` and `selcom_receipt`. Both are
 * always `undefined`, so since the rails went live NO spend has recorded the
 * charges Selcom actually took or the receipt it issued. Nothing failed loudly;
 * the fields simply stayed null and nobody read them.
 *
 * The lesson is not "use snake_case". It is that a payload from someone else's
 * system must be read through one function that tolerates both conventions and
 * KEEPS THE RAW ANSWER, so the next field we guessed wrong about is visible in
 * the record instead of silently absent.
 *
 * That matters most for a utility purchase. A LUKU payment's product is the
 * TOKEN the customer types into their meter — not the receipt. If the token is
 * dropped, the customer has paid and received nothing, which is exactly what
 * happened on 30 July 2026 (meter 24219217817, two payments, both tokens
 * delivered only to our own Selcom Biz SMS).
 */

/** Case- and convention-insensitive lookup: `total_charges` ≡ `totalCharges` ≡ `TotalCharges`. */
function pick(data: Record<string, unknown> | undefined, ...names: string[]): unknown {
  if (!data) return undefined
  const norm = (s: string) => s.replace(/[_\-\s]/g, '').toLowerCase()
  const wanted = new Set(names.map(norm))
  for (const [k, v] of Object.entries(data)) {
    if (wanted.has(norm(k)) && v != null && v !== '') return v
  }
  return undefined
}

function asNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

export interface SelcomSettlement {
  /** What Selcom actually charged on top of the principal. */
  actualChargesTzs?: number
  /** Selcom's own receipt number for the transaction. */
  selcomReceipt?: string
  /**
   * The utility voucher the customer must enter at their meter — the whole
   * point of a LUKU purchase. Named broadly because vendors differ.
   */
  utilityToken?: string
  /** Units purchased, e.g. "2.8kWh" for electricity. */
  utilityUnits?: string
  /** The biller's own reference/receipt, distinct from Selcom's. */
  utilityReceipt?: string
  /** Human-readable fee breakdown, e.g. "Fee 23, VAT 5, Ex Duty 2". */
  chargesSummary?: string
  /**
   * Selcom's answer, unmodified.
   *
   * Kept deliberately. Every field above is a guess about someone else's
   * naming; this is the record that lets the next wrong guess be found by
   * reading a row rather than by a customer complaining.
   */
  raw?: Record<string, unknown>
}

/**
 * Read what matters out of a settled Selcom transaction payload.
 *
 * Every field is optional and absent-on-doubt: this runs on a money path and
 * must never throw, whatever shape arrives. An unrecognised payload yields
 * `{ raw }` alone, which is still strictly more than the previous behaviour.
 */
export function readSelcomSettlement(data: unknown): SelcomSettlement {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return {}
  const d = data as Record<string, unknown>

  return {
    actualChargesTzs: asNumber(pick(d, 'total_charges', 'totalcharges', 'charges', 'fee')),
    selcomReceipt: asString(pick(d, 'selcom_receipt', 'selcomreceipt', 'receipt_number')),
    // Vendors label the voucher inconsistently; check every name we have seen
    // or been told about, and fall back to the raw payload when none match.
    utilityToken: asString(pick(d, 'token', 'utility_token', 'meter_token', 'voucher', 'voucher_code', 'stoken')),
    utilityUnits: asString(pick(d, 'units', 'utility_units', 'unit', 'kwh')),
    utilityReceipt: asString(pick(d, 'utility_receipt', 'biller_receipt', 'utilityref_receipt', 'third_party_receipt')),
    chargesSummary: asString(pick(d, 'charges_summary', 'chargessummary')),
    raw: d,
  }
}

/**
 * Merge a settlement into a spend descriptor without overwriting a value we
 * already hold with an absent one — a later status query that omits a field
 * must not erase what an earlier one told us.
 */
export function mergeSettlement(
  descriptor: Record<string, unknown>,
  settlement: SelcomSettlement
): Record<string, unknown> {
  const out = { ...descriptor }
  const set = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value
  }
  set('actualChargesTzs', settlement.actualChargesTzs)
  set('selcomReceipt', settlement.selcomReceipt)
  set('utilityToken', settlement.utilityToken)
  set('utilityUnits', settlement.utilityUnits)
  set('utilityReceipt', settlement.utilityReceipt)
  set('chargesSummary', settlement.chargesSummary)
  set('selcomRaw', settlement.raw)
  return out
}

/**
 * True when this spend owed the customer a voucher and we do not have one.
 *
 * A bill payment that settles without a token is a completed payment with an
 * undelivered product. It should be visible as such rather than reported as a
 * clean success — the customer cannot use a receipt.
 */
export function isUndeliveredUtilityPurchase(descriptor: Record<string, unknown>): boolean {
  return descriptor.kind === 'bill' && !descriptor.utilityToken
}
