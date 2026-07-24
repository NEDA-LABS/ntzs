/**
 * Selcom PSP Client
 * Tanzania custodian + payment provider for nTZS.
 *
 * Selcom is (a) the planned custodian bank holding the nTZS fiat reserve and
 * (b) onboarding as a consolidated PSP. This module targets Selcom's
 * **Business API** (https://developer.selcom.business):
 *   - disbursement to wallet & bank   → sendPayout / sendBankPayout
 *   - transaction status query        → checkPayoutStatus
 *   - account/charge lookup           → lookupRecipientName / calculatePayoutFee
 *   - balance                         → getBalance
 *   - statement                       → getStatement (reserve reconciliation)
 *   - collections (push-USSD)         → initiatePayment / checkPaymentStatus
 *
 * Ported from the feat/multi-psp-selcom-migration branch (built + sandbox-
 * tested there, 14 Jul 2026) into the current multi-rail architecture. The
 * rail is CAPABILITY-GATED OFF until production details land — see
 * routing.ts: SELCOM_COLLECTIONS_ENABLED / SELCOM_DISBURSEMENTS_ENABLED.
 *
 * Key differences from Snippe / AzamPay:
 * - Auth: RSA-SHA256 asymmetric signing (NOT a bearer key / JWT). Every request
 *   carries `api-key`, `timestamp`, `digest`, `signed-fields` headers. The
 *   private key is ours; Selcom holds the matching public key.
 * - IP whitelisting: requests fail with code 611 unless the egress IP is
 *   whitelisted. Vercel functions have no static egress IP — route through a
 *   fixed-IP gateway/proxy in production (same constraint as AzamPay
 *   disbursements).
 * - One endpoint for ALL disbursements: POST /v1/transaction/process. Mobile vs
 *   bank vs internal is selected by `recipientFiCode`.
 * - Callbacks are NOT signed. Authenticity = confirm-by-poll: on every callback
 *   re-query GET /v1/transaction/query before acting (mint/burn). See
 *   confirmPayout() at the bottom of this file.
 *
 * ⚠ Endpoint paths, field names, FI codes, purpose codes and response shapes
 * come from the published prelive docs + the NEDA sandbox Postman collection
 * and MUST be re-verified against Selcom's pre-live before going live. Items
 * needing confirmation are flagged with ⚠.
 */

import crypto from 'crypto'

import { estimateSendMoneyFee } from './selcom-fees'
export { estimateSendMoneyFee }

// ─── Config ─────────────────────────────────────────────────────────────────

function getSelcomEnv(): 'sandbox' | 'production' {
  return process.env.SELCOM_ENV === 'production' ? 'production' : 'sandbox'
}

/**
 * Business API base URL. Endpoints are appended as `/v1/...`.
 * Per-environment bases (prelive docs, Jul 2026):
 *   sandbox : https://sandbox.selcom.business            (proven working)
 *   prelive : https://prelive.selcom.business/api/gateway (paths are /api/gateway/v1/*)
 *   prod    : https://api.selcom.business                 (docs state base ".../v1")
 * Override via SELCOM_BIZ_BASE_URL (set it to the prelive value incl. /api/gateway
 * when testing against prelive).
 */
function getBaseUrl(): string {
  if (process.env.SELCOM_BIZ_BASE_URL) return process.env.SELCOM_BIZ_BASE_URL
  return getSelcomEnv() === 'production'
    ? 'https://api.selcom.business'
    : 'https://sandbox.selcom.business'
}

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`${key} is not configured`)
  return v
}

function getApiKey(): string {
  // Trim paste artifacts — a trailing newline or quote in the env value
  // reaches Selcom as part of the header and reads as "API key not found".
  return requireEnv('SELCOM_API_KEY').trim().replace(/^["']+|["']+$/g, '')
}

/**
 * RSA private key used to sign requests. Accepted forms (all seen in the
 * wild as env-var paste shapes):
 *   - proper multi-line PEM
 *   - PEM whose newlines were collapsed by a clipboard/editor (repaired here)
 *   - base64-encoded PEM (the documented single-line form)
 *   - base64-encoded DER (PKCS#8 or PKCS#1)
 * Surrounding quotes and stray whitespace are tolerated. The parsed KeyObject
 * is memoized per raw value.
 */
function cleanRawKey(): string {
  return requireEnv('SELCOM_PRIVATE_KEY').trim().replace(/^["']+|["']+$/g, '')
}

/** Rebuild a PEM whose line breaks were lost in a paste: 64-char body lines
 * between the original header/footer. Returns input unchanged if intact. */
function repairPem(pem: string): string {
  if (pem.includes('\n')) return pem
  const m = pem.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*)-----END \1-----/)
  if (!m) return pem
  const body = m[2].replace(/\s+/g, '')
  const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? body
  return `-----BEGIN ${m[1]}-----\n${wrapped}\n-----END ${m[1]}-----\n`
}

let cachedKey: { raw: string; key: crypto.KeyObject } | null = null

function tryLoadPrivateKey(): crypto.KeyObject | null {
  const raw = process.env.SELCOM_PRIVATE_KEY ? cleanRawKey() : ''
  if (!raw) return null
  if (cachedKey && cachedKey.raw === raw) return cachedKey.key

  const candidates: Array<Buffer> = []
  if (raw.includes('BEGIN')) {
    candidates.push(Buffer.from(repairPem(raw)))
  } else {
    const buf = Buffer.from(raw.replace(/\s+/g, ''), 'base64')
    const asText = buf.toString('utf8')
    if (asText.includes('BEGIN')) candidates.push(Buffer.from(repairPem(asText.trim())))
    else candidates.push(buf) // possibly raw DER
  }

  for (const c of candidates) {
    try { const k = crypto.createPrivateKey(c); cachedKey = { raw, key: k }; return k } catch { /* next */ }
    try { const k = crypto.createPrivateKey({ key: c, format: 'der', type: 'pkcs8' }); cachedKey = { raw, key: k }; return k } catch { /* next */ }
    try { const k = crypto.createPrivateKey({ key: c, format: 'der', type: 'pkcs1' }); cachedKey = { raw, key: k }; return k } catch { /* next */ }
  }
  return null
}

/**
 * Non-secret description of the configured key for ops surfaces: lengths,
 * detected form, and a short fingerprint so a human can compare the deployed
 * value against their clipboard (`pbpaste | tr -d '\n' | shasum -a 256 |
 * cut -c1-8`). NEVER includes key material.
 */
export function selcomKeyDiagnostics(): string {
  const raw = process.env.SELCOM_PRIVATE_KEY
  if (!raw) return 'key not set'
  const t = raw.trim()
  const parts = [
    `len:${raw.length}`,
    `fp:${crypto.createHash('sha256').update(t).digest('hex').slice(0, 8)}`,
  ]
  if (t.includes('BEGIN')) {
    parts.push('form:pem', t.includes('\n') ? 'newlines:yes' : 'newlines:collapsed')
  } else {
    const cleaned = t.replace(/\s+/g, '')
    const validB64 = /^[A-Za-z0-9+/]+=*$/.test(cleaned)
    parts.push('form:base64', validB64 ? 'charset:ok' : 'charset:INVALID')
    if (validB64) {
      parts.push(Buffer.from(cleaned, 'base64').toString('utf8').includes('BEGIN') ? 'decodes-to:pem' : 'decodes-to:non-pem')
    }
  }
  parts.push(`parses:${tryLoadPrivateKey() ? 'yes' : 'NO'}`)
  // Which gateway we're calling + api-key hygiene (length only, never the key):
  // 'API key not found' with the right key usually means the wrong host
  // (prelive-issued credentials don't exist on api.selcom.business) or paste
  // whitespace — both visible here.
  try {
    parts.push(`host:${new URL(getBaseUrl()).host}`)
  } catch {
    parts.push('host:INVALID-BASE-URL')
  }
  const apiRaw = process.env.SELCOM_API_KEY
  if (!apiRaw) parts.push('apiKey:not-set')
  else {
    parts.push(`apiKeyLen:${apiRaw.trim().replace(/^["']+|["']+$/g, '').length}`)
    if (apiRaw !== apiRaw.trim()) parts.push('apiKey:HAD-WHITESPACE(now trimmed)')
  }
  return parts.join(' · ')
}

function getPrivateKey(): crypto.KeyObject {
  const key = tryLoadPrivateKey()
  if (!key) throw new Error(`[selcom] SELCOM_PRIVATE_KEY could not be parsed (${selcomKeyDiagnostics()})`)
  return key
}

/**
 * Disbursement purpose code (required by /v1/transaction/process).
 * Valid codes are published in the prelive docs Purpose Codes table; invalid
 * codes fail with error 651. 'FT' (funds transfer) is the generic default —
 * note our earlier sandbox guess 'CASHOUT' is NOT in the table (sandbox
 * validation was lenient). Override via SELCOM_DEFAULT_PURPOSE.
 */
function getDefaultPurpose(): string {
  return process.env.SELCOM_DEFAULT_PURPOSE || 'FT'
}

/**
 * Organization account number linked to the API credentials (e.g. the
 * disbursement account). Required by the Balance and Statement APIs.
 * Spaces are stripped (the portal displays it grouped: "13009 09436 454").
 * The NEDA collections sandbox (sbsandbox.selcom.dev) uses 5529100010951.
 */
function getAccountNumber(): string {
  return requireEnv('SELCOM_ACCOUNT_NUMBER').replace(/\s+/g, '')
}

/**
 * Disbursement endpoint path. Canonical environments (Dhimant, 14 Jul 2026:
 * sandbox.selcom.business / api.selcom.business) use /v1/transaction/process —
 * the default, proven live. The /v1/transaction/neda-pay route from the NEDA
 * Postman collection exists ONLY on Selcom's internal dev box
 * (sbsandbox.selcom.dev; it 404s on canonical) — set SELCOM_DISBURSE_PATH
 * when testing there.
 */
function getDisbursePath(): string {
  return process.env.SELCOM_DISBURSE_PATH || '/v1/transaction/process'
}

/**
 * The `utilityRef` sent on push-USSD collections. Selcom's sample uses
 * '255711410410' — the exact semantics (our collection wallet? a merchant
 * reference?) are ⚠ unconfirmed, so this is required configuration and we
 * fail loudly rather than guess a default.
 */
function getUtilityRef(): string {
  return requireEnv('SELCOM_UTILITY_REF')
}

// ─── Request signing (RSA-SHA256) ────────────────────────────────────────────

export interface SignedField {
  name: string
  /** Must serialise EXACTLY as it appears in the request body / query string. */
  value: string | number
}

/**
 * Build the four auth headers + a body object for a signed request.
 *
 * Signing string (per docs): `timestamp=<ts>&<f1>=<v1>&<f2>=<v2>&...`
 *   - `timestamp` always leads the string but is EXCLUDED from `signed-fields`.
 *   - fields are signed in the exact order given (and in that same order they
 *     populate the body / query string, so the signature matches the payload).
 *   - digest = Base64( RSA-SHA256( signing_string, privateKey ) ).
 *
 * Returning `body` built from the same ordered fields guarantees the bytes we
 * sign match the bytes we send — the docs warn signatures break on any extra
 * space or type coercion.
 *
 * Exported for unit tests (signature verified against the public key).
 */
export function signRequest(fields: SignedField[]): {
  headers: Record<string, string>
  body: Record<string, string | number>
  timestamp: string
} {
  const timestamp = new Date().toISOString() // UTC ISO-8601 w/ ms, e.g. 2026-06-25T06:01:03.273Z
  const signingString =
    `timestamp=${timestamp}` + fields.map((f) => `&${f.name}=${f.value}`).join('')

  const signer = crypto.createSign('RSA-SHA256')
  signer.update(signingString, 'utf8')
  signer.end()
  const digest = signer.sign(getPrivateKey(), 'base64')

  const headers: Record<string, string> = {
    'api-key': getApiKey(),
    'timestamp': timestamp,
    'digest': digest,
    'signed-fields': fields.map((f) => f.name).join(','),
    'Content-Type': 'application/json',
  }
  const body = Object.fromEntries(fields.map((f) => [f.name, f.value]))
  return { headers, body, timestamp }
}

// ─── Phone Normalization ──────────────────────────────────────────────────────
// Identical to Snippe / AzamPay (255XXXXXXXXX, no + prefix).

export function normalizePhone(phone: string): string {
  let n = phone.replace(/[\s\-+]/g, '')
  if (n.startsWith('0')) n = '255' + n.substring(1)
  if (!n.startsWith('255')) n = '255' + n
  return n
}

export function isValidTanzanianPhone(phone: string): boolean {
  const normalized = normalizePhone(phone)
  if (!/^255\d{9}$/.test(normalized)) return false
  // Keep in sync with the copies in snippe.ts / azampay.ts (61/62 Halotel,
  // 73 TTCL included — routable networks).
  const prefix = normalized.slice(3, 5)
  const validPrefixes = ['74', '75', '76', '77', '78', '68', '69', '71', '65', '67', '61', '62', '73']
  return validPrefixes.includes(prefix)
}

// ─── Financial-institution (FI) codes ────────────────────────────────────────

/**
 * Map a Tanzanian mobile prefix → Selcom mobile-wallet FI code (recipientFiCode).
 *
 * Codes from the prelive docs "Destination Shortcodes" table (Jul 2026).
 * ⚠ One inconsistency to confirm with Selcom: their own wallet-transfer example
 * uses "MPESA" while the shortcode table says VMCASHIN — table assumed correct.
 * detectWalletFiCode throws on an unmapped prefix so we fail loudly, never guess.
 */
const MOBILE_FI_CODES: Record<string, string> = {
  vodacom: 'VMCASHIN', // Vodacom M-Pesa — 74/75/760-7
  airtel: 'AMCASHIN', //  Airtel Money — 68/69/78/768-9
  tigo: 'TPCASHIN', //    Mixx by Yas (ex Tigo Pesa) — 71/65/67/77
  halotel: 'HPCASHIN', // Halo Pesa — 61/62
  ttcl: 'TTCASHIN', //    TTCL Pesa — 73
}

/** Exported for unit tests. */
export function detectWalletFiCode(normalizedPhone: string): string {
  const prefix = normalizedPhone.slice(3, 5)
  if (['74', '75', '76'].includes(prefix)) return MOBILE_FI_CODES.vodacom
  if (['68', '69', '78'].includes(prefix)) return MOBILE_FI_CODES.airtel
  if (['71', '65', '67', '77'].includes(prefix)) return MOBILE_FI_CODES.tigo
  if (['61', '62'].includes(prefix)) return MOBILE_FI_CODES.halotel
  if (['73'].includes(prefix)) return MOBILE_FI_CODES.ttcl
  throw new Error(`[selcom] no wallet FI code mapped for phone prefix ${prefix}`)
}

// ─── Shared transaction result shape ──────────────────────────────────────────

interface SelcomTransactionResult {
  success?: boolean
  error_code?: number
  message?: string
  result?: 'SUCCESS' | 'INPROGRESS' | 'AMBIGUOUS' | 'FAIL'
  resultcode?: string
  data?: {
    trans_id?: string
    selcom_receipt?: string
    status?: string // ACCEPTED (async) | COMPLETED (sync)
    amount?: number // TOTAL debited from source = principal_amount + total_charges
    principal_amount?: number // what the recipient receives
    total_charges?: number // fees + taxes charged ON TOP of principal
    charges_summary?: string // e.g. "Fee 385, VAT 76, Excise Duty 39"
    currency?: string
  }
}

/** resultcodes Selcom returns while a transfer is still being processed. */
const INPROGRESS_RESULT_CODES = new Set(['111', '927'])

// ─────────────────────────────────────────────────────────────────────────────
// OFF-RAMP (disbursement / redemption)
// ─────────────────────────────────────────────────────────────────────────────

export interface SelcomPayoutRequest {
  amountTzs: number
  recipientPhone: string
  recipientName: string
  narration?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface SelcomPayoutResponse {
  success: boolean
  reference?: string
  externalReference?: string
  fees?: number
  total?: number
  error?: string
  errorCode?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Interpret a /v1/transaction/process response.
 *
 * SUCCESS / INPROGRESS (resultcode 000/111/927) → accepted; final outcome comes
 *   via callback or query. We treat both as a successful *initiation*.
 * AMBIGUOUS → Selcom cannot confirm whether the debit happened. NEVER retry
 *   (risk of double-payout); surface for manual reconciliation, keeping the
 *   receipt so the burn record stays linkable.
 * FAIL → terminal failure.
 */
function interpretDisbursement(
  result: SelcomTransactionResult,
  fallbackTransId: string
): SelcomPayoutResponse {
  const reference = result.data?.trans_id || fallbackTransId
  const externalReference = result.data?.selcom_receipt

  if (result.result === 'SUCCESS' || result.result === 'INPROGRESS' || INPROGRESS_RESULT_CODES.has(result.resultcode ?? '')) {
    // Selcom charges fees ON TOP of the principal; `amount` is the total debited
    // from the source (reserve) account. Capture both for reconciliation.
    return {
      success: true,
      reference,
      externalReference,
      fees: result.data?.total_charges,
      total: result.data?.amount,
    }
  }
  if (result.result === 'AMBIGUOUS') {
    return {
      success: false,
      error: 'Ambiguous disbursement status — manual reconciliation required',
      reference,
      externalReference,
      errorCode: result.resultcode,
    }
  }
  return {
    success: false,
    error: result.message || 'Disbursement failed',
    reference,
    externalReference,
    errorCode: result.resultcode,
  }
}

export interface SelcomDisbursementParams {
  recipientFiCode: string
  recipientAccount: string
  recipientName: string
  amountTzs: number
  purpose?: string
  narration?: string
  /** Idempotency key, reused across retries. Defaults to a random UUID. */
  transId?: string
}

/**
 * Core disbursement primitive — signs and posts POST /v1/transaction/process
 * for ANY destination (mobile wallet, bank, or internal SB2SELCOM), selected by
 * `recipientFiCode`. sendPayout / sendBankPayout are thin wrappers over this.
 *
 * `transId` is generated once and REUSED across retries — Selcom treats it as
 * the idempotency key, so retrying after a transport failure cannot double-pay.
 * We only retry transport-level failures (HTTP 5xx / network); any decisive
 * Selcom result (FAIL/AMBIGUOUS) is returned without retry.
 */
export async function processDisbursement(params: SelcomDisbursementParams): Promise<SelcomPayoutResponse> {
  const transId = params.transId || crypto.randomUUID()
  // Field ORDER matters — it defines both the body and the signing string.
  return postSignedTransaction(
    getDisbursePath(),
    [
      { name: 'transId', value: transId },
      { name: 'recipientFiCode', value: params.recipientFiCode },
      { name: 'recipientAccount', value: params.recipientAccount },
      { name: 'recipientName', value: params.recipientName },
      { name: 'amount', value: params.amountTzs },
      { name: 'purpose', value: params.purpose || getDefaultPurpose() },
      { name: 'remarks', value: params.narration || 'nTZS disbursement' },
    ],
    transId,
    'disbursement'
  )
}

/**
 * Shared money-moving POST used by disbursement, bill-pay and lipa-payout —
 * all three speak the same result envelope and the same safety rules:
 *
 * - `transId` is REUSED across transport retries — Selcom treats it as the
 *   idempotency key, so retrying after a transport failure cannot double-pay.
 * - Only transport-level failures (HTTP 5xx / network) are retried; any
 *   decisive Selcom result (FAIL/AMBIGUOUS) is returned without retry.
 * - 643 duplicate-transId means a previous attempt actually landed: the
 *   transaction's real status is resolved via /v1/transaction/query.
 */
async function postSignedTransaction(
  path: string,
  fields: SignedField[],
  transId: string,
  label: string
): Promise<SelcomPayoutResponse> {
  const MAX_ATTEMPTS = 3
  const BACKOFF_MS = [0, 1000, 3000]
  let lastError: string | undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt] > 0) await sleep(BACKOFF_MS[attempt])

    try {
      const { headers, body } = signRequest(fields)

      const response = await fetch(`${getBaseUrl()}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })

      const result = (await response.json()) as SelcomTransactionResult

      if (process.env.SELCOM_DEBUG) {
        console.log('[selcom] raw response', { httpStatus: response.status, body: result })
      }

      // 643 = duplicate transId. Since transId is reused across our retries,
      // this means a PREVIOUS attempt (whose response we lost to a transport
      // failure) actually landed. The transaction's real status — not this
      // error — is the truth: resolve it via the status query.
      if (result.resultcode === '643' || result.error_code === 643) {
        const st = await checkPayoutStatus(transId)
        console.log(`[selcom] duplicate transId resolved via query`, { label, transId, status: st.status, attempt: attempt + 1 })
        if (st.status === 'completed' || st.status === 'pending') {
          return { success: true, reference: transId }
        }
        return {
          success: false,
          error:
            st.status === 'failed'
              ? st.failureReason || `${label} failed`
              : 'Duplicate transaction with unknown status — manual reconciliation required',
          reference: transId,
          errorCode: '643',
        }
      }

      if (response.status < 500) {
        const mapped = interpretDisbursement(result, transId)
        console.log(`[selcom] ${label} result:`, {
          transId,
          result: result.result,
          resultcode: result.resultcode,
          success: mapped.success,
          attempt: attempt + 1,
        })
        return mapped
      }

      // HTTP 5xx — request may not have been processed; safe to retry (idempotent transId).
      lastError = result.message || `Selcom HTTP ${response.status}`
      console.error(`[selcom] ${label} 5xx, will retry`, { attempt: attempt + 1, status: response.status })
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Failed to connect to Selcom'
      console.error(`[selcom] ${label} fetch error`, { attempt: attempt + 1, error: lastError })
    }
  }

  return { success: false, error: lastError || `${label} failed`, reference: transId }
}

// ─── Bill pay + Lipa (merchant) payouts — "spend your nTZS" rails ─────────────
// Endpoints from Selcom's "SB API for NEDA Labs with Lipa and Bill Pay"
// Postman collection (Dhimant, 24 Jul 2026). Selcom-side deployment in
// progress — exercise via POST /api/admin/selcom-spend-test (flag-gated)
// before wiring any user-facing flow. ⚠ Fee tariffs and the utilityCode
// catalogue are pending from Selcom.

export interface SelcomBillPayRequest {
  /** Biller/utility code, e.g. 'ATOP' (airtime top-up) — catalogue ⚠ pending. */
  utilityCode: string
  /** The bill/control/reference number at the biller. */
  utilityRef: string
  amountTzs: number
  /** Idempotency key, reused across retries. Defaults to a random UUID. */
  transId?: string
}

/** Field order defines body + signature — exactly the collection's order. */
export function buildBillPayFields(req: SelcomBillPayRequest, transId: string): SignedField[] {
  return [
    { name: 'transId', value: transId },
    { name: 'utilityCode', value: req.utilityCode },
    { name: 'utilityRef', value: req.utilityRef },
    { name: 'amount', value: req.amountTzs },
  ]
}

/** Pay a utility/government bill from the Selcom account. POST /v1/transaction/neda-bill-pay */
export async function payBill(req: SelcomBillPayRequest): Promise<SelcomPayoutResponse> {
  const transId = req.transId || crypto.randomUUID()
  return postSignedTransaction('/v1/transaction/neda-bill-pay', buildBillPayFields(req, transId), transId, 'bill-pay')
}

export interface SelcomLipaPayRequest {
  /** Merchant Lipa Namba (pay number). */
  payNumber: string
  /** Optional network hint per the collection. OMITTED entirely when absent —
   * signed-fields derive from the keys present, and an empty-string field
   * would change the signature vs. their reference signer. */
  network?: string
  amountTzs: number
  /** Idempotency key, reused across retries. Defaults to a random UUID. */
  transId?: string
}

/** Field order defines body + signature — exactly the collection's order. */
export function buildLipaFields(req: SelcomLipaPayRequest, transId: string): SignedField[] {
  const fields: SignedField[] = [
    { name: 'transId', value: transId },
    { name: 'payNumber', value: req.payNumber },
  ]
  if (req.network) fields.push({ name: 'network', value: req.network })
  fields.push({ name: 'amount', value: req.amountTzs })
  return fields
}

/** Pay a merchant's Lipa Namba from the Selcom account. POST /v1/transaction/neda-lipa-payout */
export async function payLipa(req: SelcomLipaPayRequest): Promise<SelcomPayoutResponse> {
  const transId = req.transId || crypto.randomUUID()
  return postSignedTransaction('/v1/transaction/neda-lipa-payout', buildLipaFields(req, transId), transId, 'lipa-payout')
}

/** Send a mobile-money payout — resolves the wallet FI code from the phone prefix. */
export async function sendPayout(request: SelcomPayoutRequest): Promise<SelcomPayoutResponse> {
  const phone = normalizePhone(request.recipientPhone)
  return processDisbursement({
    recipientFiCode: detectWalletFiCode(phone),
    recipientAccount: phone,
    recipientName: request.recipientName,
    amountTzs: request.amountTzs,
    narration: request.narration || 'nTZS withdrawal',
  })
}

// ─── Bank Payout ──────────────────────────────────────────────────────────────

export interface SelcomBankPayoutRequest {
  amountTzs: number
  recipientName: string
  bankAccount: string
  /**
   * ⚠ Must be Selcom's institution code for the destination bank (from the
   * FI-code list), NOT a free-text bank name. Map upstream or pass the code.
   */
  bankName: string
  narration?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

/**
 * Send a bank payout — same endpoint, `recipientFiCode` is the bank's
 * institution code (⚠ pass Selcom's FI code, not a free-text bank name).
 */
export async function sendBankPayout(request: SelcomBankPayoutRequest): Promise<SelcomPayoutResponse> {
  return processDisbursement({
    recipientFiCode: request.bankName,
    recipientAccount: request.bankAccount,
    recipientName: request.recipientName,
    amountTzs: request.amountTzs,
    narration: request.narration || 'nTZS treasury withdrawal',
  })
}

// ─── Payout Status Check ──────────────────────────────────────────────────────

export interface SelcomPayoutStatusResponse {
  status: 'completed' | 'failed' | 'reversed' | 'pending' | 'unknown'
  failureReason?: string
  completedAt?: string
}

/**
 * Query the authoritative status of a disbursement.
 * GET /v1/transaction/query?transId=<transId>
 *
 * This is also the confirm-by-poll mechanism for unsigned callbacks
 * (see confirmPayout). Never throws — returns 'unknown' on any error.
 */
export async function checkPayoutStatus(reference: string): Promise<SelcomPayoutStatusResponse> {
  try {
    const { headers } = signRequest([{ name: 'transId', value: reference }])
    const url = `${getBaseUrl()}/v1/transaction/query?transId=${encodeURIComponent(reference)}`

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
    const result = (await response.json()) as SelcomTransactionResult

    const status = String(result.data?.status ?? '').toUpperCase()
    if (result.result === 'SUCCESS' || status === 'COMPLETED' || result.resultcode === '000') {
      return { status: 'completed' }
    }
    if (result.result === 'INPROGRESS' || status === 'ACCEPTED' || INPROGRESS_RESULT_CODES.has(result.resultcode ?? '')) {
      return { status: 'pending' }
    }
    // data.status is ACCEPTED | COMPLETED | FAILED per the prelive docs.
    if (result.result === 'FAIL' || status === 'FAILED') {
      return { status: 'failed', failureReason: result.message }
    }
    return { status: 'unknown' }
  } catch (err) {
    console.error('[selcom] payout status check error:', err instanceof Error ? err.message : err)
    return { status: 'unknown' }
  }
}

// ─── Account / charge lookup ──────────────────────────────────────────────────

export interface SelcomAccountLookup {
  name: string | null
  /** Institution / operator name (e.g. "Vodacom M-Pesa"). */
  operator?: string
  /** Total applicable charges for the amount, when an amount was supplied. */
  charges?: number
  /** Why the lookup produced no name (Selcom's resultcode/message or the
   * transport error) — for logs and the admin probe, never end users. */
  reason?: string
}

/**
 * Validate a destination account and read its name + applicable charges.
 * GET /v1/account/lookup?bank=<fiCode>&account=<acct>&transId=<id>&amount=<amt>
 * Never throws — returns { name: null, reason } on any failure.
 *
 * ⚠ The `bank` code vocabulary for THIS endpoint is unconfirmed: Selcom's own
 * Postman example uses bank=SELCOM (Selcom Pesa) for a wallet MSISDN, while
 * the disbursement shortcode table lists *CASHIN codes. Refusals are logged
 * with their reason, and /api/admin/selcom-lookup-probe tries candidate
 * codes side by side so the right mapping is established from evidence.
 */
export async function accountLookup(fiCode: string, account: string, amount?: number): Promise<SelcomAccountLookup> {
  try {
    const fields: SignedField[] = [
      { name: 'bank', value: fiCode },
      { name: 'account', value: account },
      { name: 'transId', value: crypto.randomUUID() },
    ]
    if (amount != null) fields.push({ name: 'amount', value: amount })

    const { headers } = signRequest(fields)
    const qs = fields.map((f) => `${f.name}=${encodeURIComponent(String(f.value))}`).join('&')
    const response = await fetch(`${getBaseUrl()}/v1/account/lookup?${qs}`, {
      headers,
      signal: AbortSignal.timeout(8_000),
    })

    // Response shape per prelive docs: data.accountName / operator / charges[] / totalCharges.
    const result = (await response.json()) as {
      success?: boolean
      resultcode?: string
      message?: string
      data?: { accountName?: string; operator?: string; charges?: unknown[]; totalCharges?: number }
    }
    const d = result.data
    if (!d || !d.accountName) {
      const reason = `http:${response.status} resultcode:${result.resultcode ?? 'n/a'} message:${result.message ?? 'n/a'}`
      console.warn('[selcom] accountLookup no name', { bank: fiCode, reason })
      return { name: null, reason }
    }
    return {
      name: d.accountName,
      operator: d.operator,
      charges: d.totalCharges,
    }
  } catch (err) {
    const reason = `transport: ${err instanceof Error ? err.message : String(err)}`
    console.warn('[selcom] accountLookup failed (non-fatal):', reason)
    return { name: null, reason }
  }
}

export interface SelcomRecipientInfo {
  name: string | null
  idNumber?: string
}

/**
 * Verify the registered name on a mobile-money account before a payout.
 *
 * Uses bank=SELCOM for ALL wallet MSISDNs — established by live probe
 * (/api/admin/selcom-lookup-probe, 24 Jul 2026): bank=SELCOM resolved the
 * registered owner of a Vodacom number, while the per-network *CASHIN codes
 * are DISBURSEMENT-ONLY vocabulary (lookup answers 642 "Lookup failed") and
 * operator spellings like VODACOM/MPESA are not FI codes at all (651).
 * detectWalletFiCode stays authoritative for payout routing only.
 */
const LOOKUP_WALLET_FI_CODE = 'SELCOM'

export async function lookupRecipientName(phone: string): Promise<SelcomRecipientInfo> {
  const normalized = normalizePhone(phone)
  const { name } = await accountLookup(LOOKUP_WALLET_FI_CODE, normalized)
  return { name }
}

/** Collection-side name lookup (kept for interface parity with AzamPay). */
export async function lookupAccountName(phone: string): Promise<{ name: string | null; phone: string }> {
  const normalized = normalizePhone(phone)
  const { name } = await lookupRecipientName(normalized)
  return { name, phone: normalized }
}

// ─── Account Balance ──────────────────────────────────────────────────────────

export interface SelcomBalanceResponse {
  available: number
  pending: number
  currency: string
  /** Whether the account is currently active (from data.active). */
  active?: boolean
  accountNumber?: string
}

/**
 * Fetch the linked organization account balance.
 * POST /v1/balance — requires `account_number` in the signed body (prelive docs).
 * Response: data.available_balance / data.currency / data.active. There is no
 * pending figure in this API; `pending` is returned as 0 for interface parity.
 *
 * When collections + disbursements settle to this same account, this balance is
 * the live figure for nTZS reserve attestation (see reserves reconciliation).
 */
export async function getBalance(): Promise<SelcomBalanceResponse> {
  const { headers, body } = signRequest([{ name: 'account_number', value: getAccountNumber() }])
  const response = await fetch(`${getBaseUrl()}/v1/balance`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })

  const result = (await response.json()) as {
    success?: boolean
    message?: string
    data?: { account_number?: string; currency?: string; available_balance?: number; active?: boolean }
  }

  if (result.success === false || !result.data) {
    throw new Error(result.message || 'Failed to fetch Selcom balance')
  }

  return {
    available: result.data.available_balance ?? 0,
    pending: 0,
    currency: result.data.currency ?? 'TZS',
    active: result.data.active,
    accountNumber: result.data.account_number,
  }
}

// ─── Statement (reconciliation feed) ──────────────────────────────────────────

export interface SelcomStatementParams {
  /** Y-m-d, e.g. '2026-07-01'. Provide fromDate+toDate OR preset, not both. */
  fromDate?: string
  toDate?: string
  /** 'Today' | 'Last 7 Days' | 'This Month' | 'Last Month' | 'Last 10 Transactions' */
  preset?: string
  /** 1–500, default 10 (Selcom-side). */
  perPage?: number
  /** 1-based page index (collection body puts it right after per_page). */
  page?: number
  order?: 'ASC' | 'DESC'
}

export interface SelcomStatementResponse {
  currency: string
  /** Balance at the start/end of the requested range — reserve-attestation gold. */
  openingBalance: number
  closingBalance: number
  accountName?: string
  accountNumber?: string
  /** Transaction objects for the current page (row shape not fully documented). */
  transactions: Array<Record<string, unknown>>
  pagination?: { total?: number; perPage?: number; currentPage?: number; lastPage?: number }
}

/**
 * Pull the account statement for reserve reconciliation.
 * POST /v1/statements — signed body: account_number + (preset | from_date+to_date)
 * [+ per_page, order]. JSON listing only here; pdf/xlsx/csv exports (temp URL,
 * 1h expiry) exist but are not needed programmatically.
 *
 * Drives reserve recon: match on-chain mints/burns against custodian movements;
 * opening/closing balances anchor the attestation for the period.
 */
export async function getStatement(params: SelcomStatementParams): Promise<SelcomStatementResponse> {
  const fields: SignedField[] = [{ name: 'account_number', value: getAccountNumber() }]
  if (params.preset) {
    fields.push({ name: 'preset', value: params.preset })
  } else {
    if (!params.fromDate || !params.toDate) {
      throw new Error('[selcom] getStatement requires fromDate+toDate or a preset')
    }
    fields.push({ name: 'from_date', value: params.fromDate }, { name: 'to_date', value: params.toDate })
  }
  if (params.perPage != null) fields.push({ name: 'per_page', value: params.perPage })
  if (params.page != null) fields.push({ name: 'page', value: params.page })
  if (params.order) fields.push({ name: 'order', value: params.order })

  const { headers, body } = signRequest(fields)
  const response = await fetch(`${getBaseUrl()}/v1/statements`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  const result = (await response.json()) as {
    success?: boolean
    message?: string
    data?: {
      currency?: string
      opening_balance?: number
      closing_balance?: number
      account?: { account_name?: string; account_number?: string }
      transactions?: Array<Record<string, unknown>>
      pagination?: { total?: number; per_page?: number; current_page?: number; last_page?: number }
    }
  }
  if (result.success === false || !result.data) {
    throw new Error(result.message || 'Failed to fetch Selcom statement')
  }

  const d = result.data
  return {
    currency: d.currency ?? 'TZS',
    openingBalance: d.opening_balance ?? 0,
    closingBalance: d.closing_balance ?? 0,
    accountName: d.account?.account_name,
    accountNumber: d.account?.account_number,
    transactions: d.transactions ?? [],
    pagination: d.pagination
      ? {
          total: d.pagination.total,
          perPage: d.pagination.per_page,
          currentPage: d.pagination.current_page,
          lastPage: d.pagination.last_page,
        }
      : undefined,
  }
}

// ─── Payout Fee Calculation ───────────────────────────────────────────────────

export interface SelcomPayoutFeeResponse {
  fee: number
  total: number
}

/**
 * Estimate the payout fee before sending, from the published send-money tariff.
 * `total` is the amount debited from the source (reserve) = principal + fee,
 * since Selcom charges on top of the principal. Internal SB2SELCOM moves are
 * free (use estimateSendMoneyFee only for external rails).
 */
export async function calculatePayoutFee(amount: number): Promise<SelcomPayoutFeeResponse> {
  const fee = estimateSendMoneyFee(amount)
  return { fee, total: amount + fee }
}

// ─────────────────────────────────────────────────────────────────────────────
// ON-RAMP (collections / deposit) — push-USSD, proven on the NEDA sandbox
// (Postman collection "SB API for NEDA Labs", 13 Jul 2026):
//   POST /v1/wallet/pushussd        — PIN prompt pushed to the payer's phone
//   GET  /v1/wallet/pushussd-query  — status by our transId
// Same RSA-SHA256 signing as disbursements (their bundled reference signer
// matches signRequest byte-for-byte). Control-number flow: not yet published.
// W2B (user pays our Lipa Namba from their own menu) settles via the statement
// feed + orphan matching — wired at collections go-live.
// ─────────────────────────────────────────────────────────────────────────────

const CARD_COLLECTIONS_PENDING =
  '[selcom] Card collection is not available on the Business API — ' +
  'cards continue to route through Snippe (see lib/psp routing).'

export interface SelcomPaymentRequest {
  amountTzs: number
  phoneNumber: string
  customerEmail: string
  customerFirstname?: string
  customerLastname?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface SelcomPaymentResponse {
  success: boolean
  reference?: string
  /** Selcom's internal reference for the push (data.reference). */
  externalReference?: string
  /** Control number for the user to pay against, once that flow ships. */
  controlNumber?: string
  error?: string
}

/**
 * Initiate a mobile-money collection: push a USSD PIN prompt to the payer.
 * POST /v1/wallet/pushussd — body/signing field order: transId, utilityRef,
 * amount, msisdn (exactly Selcom's sample; amount is a STRING there).
 *
 * A SUCCESS/000 response means the push was INITIATED — it does NOT mean the
 * customer paid. Completion is discovered via checkPaymentStatus (pushussd-
 * query) and/or the portal-registered callback; minting must gate on that,
 * never on this response.
 *
 * The returned `reference` is OUR transId (what pushussd-query keys on) —
 * store it as deposit_requests.psp_reference. Selcom's own reference comes
 * back as `externalReference`.
 */
export async function initiatePayment(request: SelcomPaymentRequest): Promise<SelcomPaymentResponse> {
  const transId = crypto.randomUUID()
  const msisdn = normalizePhone(request.phoneNumber)

  try {
    // Field ORDER matters — it defines both the body and the signing string.
    const { headers, body } = signRequest([
      { name: 'transId', value: transId },
      { name: 'utilityRef', value: getUtilityRef() },
      { name: 'amount', value: String(Math.trunc(request.amountTzs)) },
      { name: 'msisdn', value: msisdn },
    ])

    const response = await fetch(`${getBaseUrl()}/v1/wallet/pushussd`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })

    const result = (await response.json()) as SelcomTransactionResult & {
      data?: { reference?: string; trans_id?: string }
    }

    if (process.env.SELCOM_DEBUG) {
      console.log('[selcom] pushussd raw response', { httpStatus: response.status, body: result })
    }

    if (result.result === 'SUCCESS' || result.resultcode === '000') {
      console.log('[selcom] push USSD initiated:', {
        transId,
        selcomReference: result.data?.reference,
        amountTzs: request.amountTzs,
        msisdn,
      })
      return { success: true, reference: transId, externalReference: result.data?.reference }
    }

    console.error('[selcom] push USSD initiation failed:', { httpStatus: response.status, result })
    return { success: false, error: result.message || 'Push USSD initiation failed' }
  } catch (err) {
    console.error('[selcom] push USSD API error:', err)
    return { success: false, error: 'Failed to connect to Selcom' }
  }
}

export interface SelcomCardPaymentRequest {
  amountTzs: number
  phoneNumber: string
  customerEmail: string
  customerFirstname?: string
  customerLastname?: string
  redirectUrl: string
  cancelUrl: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface SelcomCardPaymentResponse {
  success: boolean
  reference?: string
  paymentUrl?: string
  error?: string
}

/**
 * Card collection. Likely served by Selcom's Checkout / Payment Gateway
 * (Masterpass / Visa / MC / Amex) rather than the Business API. Cards continue
 * to route through Snippe until this is wired (see lib/psp/index.ts).
 */
export async function initiateCardPayment(): Promise<never> {
  throw new Error(CARD_COLLECTIONS_PENDING)
}

export interface SelcomPaymentStatusResponse {
  status: 'completed' | 'pending' | 'failed' | 'expired' | 'voided'
  amount?: number
  completedAt?: string
}

/** Explicit paid markers we will accept from the pushussd-query data payload. */
const PUSHUSSD_PAID_STATUSES = new Set(['COMPLETED', 'PAID', 'SETTLED'])
const PUSHUSSD_FAILED_STATUSES = new Set(['FAILED', 'CANCELLED', 'REJECTED', 'DECLINED'])
const PUSHUSSD_EXPIRED_STATUSES = new Set(['EXPIRED', 'TIMEOUT'])

/**
 * Collection status check.
 * GET /v1/wallet/pushussd-query?transId=<our transId>
 *
 * ⚠ SAFETY-CRITICAL MAPPING: the envelope's result 'SUCCESS' / resultcode
 * '000' means the QUERY succeeded — NOT that the customer paid (Selcom's own
 * sample returns SUCCESS/000 with only reference+trans_id right after
 * initiation). This function reports 'completed' ONLY on an explicit paid
 * marker inside `data` (data.status / data.payment_status ∈ COMPLETED | PAID
 * | SETTLED). Anything ambiguous → 'pending', so minting stays gated.
 * Confirm the actual paid-state payload in the first live sandbox test and
 * tighten this mapping then (SELCOM_DEBUG=1 logs the raw body).
 */
export async function checkPaymentStatus(reference: string): Promise<SelcomPaymentStatusResponse> {
  try {
    const { headers } = signRequest([{ name: 'transId', value: reference }])
    const url = `${getBaseUrl()}/v1/wallet/pushussd-query?transId=${encodeURIComponent(reference)}`

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
    const result = (await response.json()) as SelcomTransactionResult & {
      data?: { reference?: string; trans_id?: string; status?: string; payment_status?: string; amount?: number }
    }

    if (process.env.SELCOM_DEBUG) {
      console.log('[selcom] pushussd-query raw response', { httpStatus: response.status, body: result })
    }

    const paymentState = String(result.data?.status ?? result.data?.payment_status ?? '').toUpperCase()

    if (PUSHUSSD_PAID_STATUSES.has(paymentState)) {
      return { status: 'completed', amount: result.data?.amount }
    }
    if (PUSHUSSD_FAILED_STATUSES.has(paymentState) || result.result === 'FAIL') {
      return { status: 'failed' }
    }
    if (PUSHUSSD_EXPIRED_STATUSES.has(paymentState)) {
      return { status: 'expired' }
    }
    // No explicit payment-state marker (Selcom's sample omits one) → pending.
    return { status: 'pending' }
  } catch (err) {
    console.error('[selcom] pushussd-query error:', err instanceof Error ? err.message : err)
    return { status: 'pending' }
  }
}

// ─── Callbacks (confirm-by-poll) ──────────────────────────────────────────────

/**
 * Selcom disbursement callback payload.
 * POST to our registered callback URL on completion. `reference_id` (our
 * transId) and `status` are always present; the rest are configurable.
 * Expected response: 200 with `{"received": true}`.
 *
 * ⚠ Callbacks fire ONLY for SUCCESSFUL transactions (status is always
 * 'SUCCESS'; TIPS/TISS fire after final network confirmation). A FAILED payout
 * never calls back — pending payouts MUST also be resolved by a reconcile
 * poller using checkPayoutStatus (same pattern as the Snippe stuck-burns cron).
 */
export interface SelcomPayoutWebhookPayload {
  reference_id: string
  status: string // 'SUCCESS' for callbacks
  sender_account_name?: string
  sender_account_number?: string
  recipient_name?: string
  recipient_account_number?: string
  amount?: number
  charges?: number
  selcom_receipt?: string
}

/**
 * Selcom callbacks are NOT signed. Do not trust the payload — confirm the real
 * outcome by querying Selcom directly before minting/burning. This is the
 * authenticity mechanism for the webhook handler.
 *
 * ⚠ If Selcom adds a callback signature/shared-secret later, verify it here too.
 */
export async function confirmPayout(referenceId: string): Promise<SelcomPayoutStatusResponse> {
  return checkPayoutStatus(referenceId)
}
