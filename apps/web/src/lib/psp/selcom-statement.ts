/**
 * Pure parsing + matching config for the Selcom statement feed (w2b deposits).
 *
 * W2B ("wallet-to-business"): the user pays our Lipa Namba from their own
 * mobile-money menu, so there is NO push, NO callback, and NO PSP reference on
 * our side at initiation. Settlement is discovered by polling the account
 * statement and matching credits to open w2b deposit intents.
 *
 * Selcom does not fully document the statement row shape, so the parser is
 * tolerant about field NAMES but conservative about MEANING: a row is only
 * ingested when we can confidently identify a reference, a positive amount,
 * and the credit direction. Anything ambiguous is skipped WITH a reason that
 * the cron reports — never silently guessed. Skipped real credits still reach
 * us: they simply stay on the statement and are ingested once the field map
 * gains their spelling (or matched by hand from the backstage orphan queue).
 *
 * Kept free of I/O so the rules are unit-tested.
 */

/** pspChannel stamped on w2b deposit intents — the auto-matcher ONLY targets
 * this channel, so push-USSD deposits can never be auto-credited twice. */
export const W2B_CHANNEL = 'SELCOM-W2B'

/** Auto-match window: the payment must land within this many hours AFTER the
 * intent was created. Mirrors the 72h stale-attempt cutoff in backstage. */
export const W2B_MATCH_WINDOW_HOURS = 72

/** Clock slack: a payment may be timestamped slightly BEFORE the intent row
 * (user pays fast / clocks differ). Anything older than this is intent-first
 * violated and goes to manual review instead. */
export const W2B_CLOCK_SLACK_MS = 5 * 60 * 1000

export type ParsedStatementRow =
  | {
      kind: 'credit'
      reference: string
      amountTzs: number
      payerPhone: string | null
      payerName: string | null
      channel: string | null
      narrative: string | null
      occurredAt: Date | null
    }
  | { kind: 'debit' }
  | { kind: 'skipped'; reason: string }

const REFERENCE_KEYS = [
  'receipt',
  'receipt_number',
  'receiptnumber',
  'reference',
  'reference_id',
  'ref_id',
  'transid',
  'trans_id',
  'transaction_id',
  'txn_id',
]

const AMOUNT_KEYS = ['amount', 'transaction_amount', 'trans_amount', 'txn_amount']

const DIRECTION_KEYS = ['drcr', 'dr_cr', 'type', 'trans_type', 'transaction_type', 'direction', 'entry_type']

const CREDIT_AMOUNT_KEYS = ['credit', 'credit_amount', 'cr_amount']
const DEBIT_AMOUNT_KEYS = ['debit', 'debit_amount', 'dr_amount']

const PHONE_KEYS = ['msisdn', 'phone', 'payer_phone', 'sender', 'sender_msisdn', 'customer_phone', 'mobile']

const NAME_KEYS = ['payer_name', 'sender_name', 'customer_name', 'name']

const NARRATIVE_KEYS = ['narrative', 'narration', 'description', 'remarks', 'particulars', 'details']

const CHANNEL_KEYS = ['channel', 'service', 'service_name', 'operator', 'network']

const DATE_KEYS = ['date', 'trans_date', 'transaction_date', 'payment_date', 'created_at', 'datetime', 'timestamp']

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return null
}

/** Parse '12,500.00' / 12500 / '12500' → 12500. null when absent/unparseable. */
function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const cleaned = v.replace(/,/g, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function firstAmount(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!(key in row)) continue
    const n = parseAmount(row[key])
    if (n !== null) return n
  }
  return null
}

/** Pull a Tanzanian MSISDN out of free text (narratives often embed the payer
 * number). Returns the raw digit run — samePhone() compares last-9 anyway. */
export function extractPhone(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/(?:\+?255|0)[67]\d{8}/)
  return m ? m[0].replace(/^\+/, '') : null
}

/**
 * Classify one statement transaction row.
 *
 * Direction resolution, in order of trust:
 *  1. An explicit direction field ('CR'/'CREDIT'/'IN' vs 'DR'/'DEBIT'/'OUT').
 *  2. Separate credit/debit amount columns (whichever is > 0).
 *  3. A signed amount (negative = debit). A bare positive amount is NOT
 *     treated as a credit — many statements list both directions as positive.
 */
export function parseStatementRow(row: Record<string, unknown>): ParsedStatementRow {
  let direction: 'credit' | 'debit' | null = null
  const dirRaw = firstString(row, DIRECTION_KEYS)
  if (dirRaw) {
    if (/^(cr|credit|c|in|inflow|deposit|received)$/i.test(dirRaw)) direction = 'credit'
    else if (/^(dr|debit|d|out|outflow|withdrawal|sent|payment)$/i.test(dirRaw)) direction = 'debit'
  }

  let amount = firstAmount(row, AMOUNT_KEYS)

  if (direction === null) {
    const creditAmt = firstAmount(row, CREDIT_AMOUNT_KEYS)
    const debitAmt = firstAmount(row, DEBIT_AMOUNT_KEYS)
    if (creditAmt !== null && creditAmt > 0 && (debitAmt === null || debitAmt === 0)) {
      direction = 'credit'
      amount = amount ?? creditAmt
    } else if (debitAmt !== null && debitAmt > 0) {
      direction = 'debit'
    }
  }

  if (direction === null && amount !== null && amount < 0) {
    direction = 'debit'
  }

  if (direction === null) return { kind: 'skipped', reason: 'no direction field' }
  if (direction === 'debit') return { kind: 'debit' }

  if (amount === null) return { kind: 'skipped', reason: 'no amount field' }
  const amountTzs = Math.round(Math.abs(amount))
  if (amountTzs <= 0) return { kind: 'skipped', reason: 'non-positive amount' }

  const reference = firstString(row, REFERENCE_KEYS)
  if (!reference) return { kind: 'skipped', reason: 'no reference field' }

  const narrative = firstString(row, NARRATIVE_KEYS)
  const payerPhone = firstString(row, PHONE_KEYS) ?? extractPhone(narrative)

  let occurredAt: Date | null = null
  const dateRaw = firstString(row, DATE_KEYS)
  if (dateRaw) {
    const d = new Date(dateRaw)
    if (!Number.isNaN(d.getTime())) occurredAt = d
  }

  return {
    kind: 'credit',
    reference,
    amountTzs,
    payerPhone,
    payerName: firstString(row, NAME_KEYS),
    channel: firstString(row, CHANNEL_KEYS),
    narrative,
    occurredAt,
  }
}

/** True when the payment time fits the intent's auto-match window:
 * intent created no more than slack AFTER the payment, and the payment landed
 * within W2B_MATCH_WINDOW_HOURS of the intent. Outside → manual review. */
export function isWithinMatchWindow(intentCreatedAt: Date, paymentAt: Date): boolean {
  const diff = paymentAt.getTime() - intentCreatedAt.getTime()
  return diff >= -W2B_CLOCK_SLACK_MS && diff <= W2B_MATCH_WINDOW_HOURS * 3600_000
}

/** Y-m-d in East Africa Time (UTC+3) — Selcom statements are EAT-dated, so
 * date ranges must be computed in EAT or midnight-boundary payments are missed. */
export function ymdEAT(d: Date): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10)
}
