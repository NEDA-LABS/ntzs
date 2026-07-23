/**
 * SmileID V3 KYC client — international identity verification.
 *
 * Contract verified against docs.usesmileid.com (22 Jul 2026):
 *  - Auth: POST {base}/v3/token with headers smileid-partner-id +
 *    smileid-api-key; an optional multipart body binds user_id /
 *    partner_params / product INTO the issued token. Returns { token }, a JWT
 *    valid 15 minutes. Subsequent calls send SmileID-Partner-ID +
 *    SmileID-Token headers.
 *  - Environments: https://api.sandbox.smileidentity.com (accepts ONLY their
 *    fictitious test identities — never send real PII to sandbox) and
 *    https://api.smileidentity.com. Keys and callback URLs are per-env.
 *  - Every product is asynchronous: submit → 202 { job_id, user_id } → final
 *    result delivered as a webhook to the callback_url. Result statuses:
 *    clear | attention | block | error, plus an interim 'processing' while a
 *    job sits in SmileID-side human review.
 *  - Enhanced KYC (POST /v3/enhanced_kyc, JSON): government-registry ID-number
 *    lookups for CI GH KE NG UG ZA ZM ZW only. NO TANZANIA — Selcom Identity
 *    remains the NIDA authority (lib/kyc/selcom.ts + lib/kyc/ladder.ts).
 *  - Document Verification (POST /v3/document_verification, multipart):
 *    selfie + 6–8 liveness frames + document images. The liveness sequence can
 *    only come from SmileID's capture SDKs, so the server never submits this
 *    product — we mint the session token (bound to our kyc_case id via
 *    partner_params), the SDK submits from the client, and the verdict lands
 *    on app/api/webhooks/smileid.
 *  - Webhook authenticity: Response-Signature =
 *    base64(HMAC-SHA256(api_key, Response-Timestamp + partner_id + 'sid_request')).
 *    The signature does NOT cover the body, so treat payload fields as claims
 *    to apply to OUR records, never as instructions (and keep the dashboard
 *    callback-domain allowlist + optional IP allowlist enabled).
 *
 * FAIL-CLOSED by design: missing credentials, bad signatures, stale
 * timestamps, network errors, and unrecognized shapes never verify anything.
 * PII discipline matches lib/kyc/selcom.ts: response bodies are never logged —
 * diagnose unrecognized payloads with maskShape (shape only).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type SmileIdEnv = 'sandbox' | 'production'

interface SmileIdConfig {
  partnerId: string
  apiKey: string
  baseUrl: string
  env: SmileIdEnv
}

function smileIdConfig(): SmileIdConfig | null {
  const partnerId = process.env.SMILEID_PARTNER_ID
  const apiKey = process.env.SMILEID_API_KEY
  if (!partnerId || !apiKey) return null
  const env: SmileIdEnv = process.env.SMILEID_ENV === 'production' ? 'production' : 'sandbox'
  // The docs' environments page lists https://api.sandbox.smileidentity.com as
  // the sandbox base, but that hostname does not resolve in public DNS
  // (verified 22 Jul 2026). The live V3 sandbox is testapi.smileidentity.com:
  // sandbox keys mint /v3/token there (HTTP 200) and are refused by
  // production (401). SMILEID_BASE_URL overrides if the hostname ever moves.
  const baseUrl =
    process.env.SMILEID_BASE_URL ||
    (env === 'production' ? 'https://api.smileidentity.com' : 'https://testapi.smileidentity.com')
  return { partnerId, apiKey, env, baseUrl }
}

export function isSmileIdConfigured(): boolean {
  return smileIdConfig() !== null
}

export function smileIdEnvironment(): SmileIdEnv {
  return process.env.SMILEID_ENV === 'production' ? 'production' : 'sandbox'
}

/** Our SmileID partner id — clients need it in the SmileID-Partner-ID header. Null when unconfigured. */
export function smileIdPartnerId(): string | null {
  return smileIdConfig()?.partnerId ?? null
}

/** Environment-correct API base for direct capture submits (browser → SmileID). Null when unconfigured. */
export function smileIdApiBaseUrl(): string | null {
  return smileIdConfig()?.baseUrl ?? null
}

/**
 * Countries where SmileID Enhanced KYC (government-registry ID-number lookup)
 * exists. Verified from the docs' "Verify with ID Number" coverage pages —
 * note the deliberate absence of TZ.
 */
const ENHANCED_KYC_COUNTRIES = new Set(['CI', 'GH', 'KE', 'NG', 'UG', 'ZA', 'ZM', 'ZW'])

export function supportsEnhancedKyc(country: string): boolean {
  return ENHANCED_KYC_COUNTRIES.has((country ?? '').toUpperCase())
}

// ── Webhook signature ─────────────────────────────────────────────────────────

/** base64(HMAC-SHA256(api_key, timestamp + partner_id + 'sid_request')) — SmileID's scheme. */
export function computeSmileIdWebhookSignature(timestamp: string, partnerId: string, apiKey: string): string {
  return createHmac('sha256', apiKey).update(timestamp + partnerId + 'sid_request').digest('base64')
}

/** Stale-after window. SmileID retries within minutes; dashboard replays re-sign with a fresh timestamp. */
const WEBHOOK_MAX_AGE_MS = 15 * 60_000
/** Tolerated forward clock skew. */
const WEBHOOK_MAX_SKEW_MS = 5 * 60_000

/**
 * Verify an inbound SmileID webhook. Fail-closed: missing configuration,
 * missing headers, unparsable or stale timestamps, and signature mismatches
 * all return false. `nowMs` is injectable for tests.
 */
export function verifySmileIdWebhookSignature(opts: {
  signature: string | null
  timestamp: string | null
  nowMs?: number
}): boolean {
  const cfg = smileIdConfig()
  if (!cfg || !opts.signature || !opts.timestamp) return false

  const ts = Date.parse(opts.timestamp)
  if (!Number.isFinite(ts)) return false
  const now = opts.nowMs ?? Date.now()
  if (now - ts > WEBHOOK_MAX_AGE_MS || ts - now > WEBHOOK_MAX_SKEW_MS) return false

  // Signature computed on the RAW header value — never normalize the timestamp.
  const expected = Buffer.from(computeSmileIdWebhookSignature(opts.timestamp, cfg.partnerId, cfg.apiKey))
  const provided = Buffer.from(opts.signature)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

// ── Result interpretation ─────────────────────────────────────────────────────

/** Correlation handles echoed on (or bound into) a result webhook. */
export interface SmileIdCorrelation {
  /** Our kyc_cases.id, bound into the session token / request via partner_params. */
  kycCaseId: string | null
  /** SmileID job reference, when present. */
  jobId: string | null
  /** SmileID user handle, when present. */
  smileUserId: string | null
}

export type SmileIdVerdict =
  | {
      outcome: 'approved'
      fullName: string | null
      idNumber: string | null
      idType: string | null
      country: string | null
      evidence: string
    }
  | { outcome: 'review'; reason: string | null; evidence: string }
  | { outcome: 'rejected'; reason: string | null; evidence: string }
  /** The JOB failed (bad images, vendor error) — a fact about the attempt, never about the person. */
  | { outcome: 'error'; reason: string | null; evidence: string }
  /** Interim notice while SmileID reviews internally; the final webhook follows. */
  | { outcome: 'processing' }
  | { outcome: 'unrecognized'; detail: string }

export interface SmileIdInterpretation {
  correlation: SmileIdCorrelation
  verdict: SmileIdVerdict
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function stringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val
  }
  return out
}

/**
 * Interpret a SmileID result webhook payload (pure, unit-tested).
 *
 * Mapping onto the verification ladder's vocabulary:
 *   clear     → approved (unless antifraud flags fraud — then review; a clean
 *               document with a fraud signal must meet a human, fail-closed)
 *   attention → review  (Tier C: Backstage → KYC decides)
 *   block     → rejected
 *   error     → error   (job failure — retryable, never a verdict on the person)
 *   processing→ processing (interim; keep waiting)
 * Anything else is 'unrecognized' and must change nothing.
 */
export function interpretSmileIdResult(payload: unknown): SmileIdInterpretation {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      correlation: { kycCaseId: null, jobId: null, smileUserId: null },
      verdict: { outcome: 'unrecognized', detail: 'payload is not an object' },
    }
  }

  const o = payload as Record<string, unknown>
  const partnerParams = stringRecord(o.partner_params)
  const correlation: SmileIdCorrelation = {
    kycCaseId: asString(partnerParams.kyc_case_id),
    jobId: asString(o.job_id),
    smileUserId: asString(o.user_id),
  }

  const status = asString(o.status)?.toLowerCase() ?? null
  const reason = asString(o.reason)
  const product = asString(o.product) ?? 'unknown_product'

  if (status === 'processing') {
    return { correlation, verdict: { outcome: 'processing' } }
  }

  if (status !== 'clear' && status !== 'attention' && status !== 'block' && status !== 'error') {
    return { correlation, verdict: { outcome: 'unrecognized', detail: `unknown status '${status ?? '<missing>'}'` } }
  }

  // Extracted document fields (null when status is block/error).
  const idFields =
    o.id_fields && typeof o.id_fields === 'object' && !Array.isArray(o.id_fields)
      ? (o.id_fields as Record<string, unknown>)
      : {}
  const joined = [idFields.first_name, idFields.other_names, idFields.last_name]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' ')
  const fullName = asString(idFields.full_name) ?? (joined || null)
  const idNumber = asString(idFields.id_number)
  const idType = asString(idFields.id_type)
  const country = asString(idFields.country)

  // Antifraud block: a 'clear' document with a fraud signal is NOT an approval.
  const antifraud =
    o.antifraud && typeof o.antifraud === 'object' && !Array.isArray(o.antifraud)
      ? (o.antifraud as Record<string, unknown>)
      : {}
  const fraudSummary =
    antifraud.summary && typeof antifraud.summary === 'object' ? (antifraud.summary as Record<string, unknown>) : {}
  const fraudDetected = fraudSummary.fraud_detected === true
  const riskLevel =
    antifraud.fraud_risk && typeof antifraud.fraud_risk === 'object'
      ? asString((antifraud.fraud_risk as Record<string, unknown>).risk_level)
      : null

  const evidence =
    `SmileID ${product}: ${status}${reason ? ` (${reason})` : ''}` +
    ` · name: ${fullName ?? 'n/a'}` +
    ` · doc: ${idType ?? '?'} ${country ?? '?'}${idNumber ? ` #${idNumber}` : ''}` +
    ` · fraud risk: ${riskLevel ?? 'n/a'}${fraudDetected ? ' · FRAUD FLAGGED' : ''}` +
    ` · receipt: ${asString(o.kyc_receipt) ? 'issued' : 'none'}`

  if (status === 'clear') {
    if (fraudDetected) {
      return { correlation, verdict: { outcome: 'review', reason: 'fraud_flagged', evidence } }
    }
    return { correlation, verdict: { outcome: 'approved', fullName, idNumber, idType, country, evidence } }
  }
  if (status === 'attention') return { correlation, verdict: { outcome: 'review', reason, evidence } }
  if (status === 'block') return { correlation, verdict: { outcome: 'rejected', reason, evidence } }
  return { correlation, verdict: { outcome: 'error', reason, evidence } }
}

// ── Outbound API calls ────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 20_000

/** Products a v3 token can be scoped to (from the /v3/token spec). */
export type SmileIdProduct =
  | 'aml'
  | 'basic_kyc'
  | 'one_time_aml'
  | 'biometric_kyc'
  | 'address_verification'
  | 'document_verification'
  | 'enhanced_document_verification'
  | 'enhanced_kyc'
  | 'phone_number_verification'
  | 'smart_selfie_authentication'
  | 'smart_selfie_registration'
  | 'smart_selfie_compare'

export type SmileIdTokenResult = { status: 'ok'; token: string } | { status: 'unavailable'; error: string }

/**
 * Mint a short-lived (15 min) v3 token. For SDK capture sessions, bind the
 * kyc_case id via partnerParams (and scope with userId/product) — the result
 * webhook echoes partner_params, which is our correlation path back to the
 * case. The API key never leaves the server.
 */
export async function mintSmileIdToken(opts?: {
  userId?: string
  partnerParams?: Record<string, string>
  product?: SmileIdProduct
}): Promise<SmileIdTokenResult> {
  const cfg = smileIdConfig()
  if (!cfg) return { status: 'unavailable', error: 'SMILEID_PARTNER_ID / SMILEID_API_KEY not configured' }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    // Body is optional multipart — only sent when something is being bound.
    // partner_params MUST be a JSON-string field: bracket-style
    // (partner_params[k]) is silently dropped by the token service — verified
    // 22 Jul 2026 by decoding the issued JWT's claims against sandbox.
    let body: FormData | undefined
    if (opts && (opts.userId || opts.partnerParams || opts.product)) {
      body = new FormData()
      if (opts.userId) body.set('user_id', opts.userId)
      if (opts.product) body.set('product', opts.product)
      if (opts.partnerParams) body.set('partner_params', JSON.stringify(opts.partnerParams))
    }

    const res = await fetch(`${cfg.baseUrl}/v3/token`, {
      method: 'POST',
      headers: { 'smileid-partner-id': cfg.partnerId, 'smileid-api-key': cfg.apiKey },
      body,
      signal: controller.signal,
    })
    clearTimeout(timer)

    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      return { status: 'unavailable', error: `Non-JSON token response (HTTP ${res.status})` }
    }
    const token = json && typeof json === 'object' ? asString((json as Record<string, unknown>).token) : null
    if (res.status >= 200 && res.status < 300 && token) return { status: 'ok', token }
    return { status: 'unavailable', error: `Token mint failed (HTTP ${res.status})` }
  } catch (err) {
    return { status: 'unavailable', error: err instanceof Error ? err.message : 'Network error' }
  }
}

export type SmileIdSubmission =
  | { status: 'accepted'; jobId: string | null; smileUserId: string | null }
  | { status: 'unavailable'; error: string }

/**
 * Submit an Enhanced KYC job (server-to-server ID-number lookup; supported
 * countries only — see supportsEnhancedKyc). The verdict arrives on the
 * webhook; a 202 here only means the job was accepted.
 */
export async function submitEnhancedKyc(input: {
  country: string
  idType: string
  idNumber: string
  givenNames: string
  lastName: string
  email?: string
  phoneNumber?: string
  consent: { grantedAt: string; noticeLanguage: string; privacyPolicyUrl: string }
  callbackUrl?: string
  /** Correlation metadata; always include kyc_case_id. */
  partnerParams?: Record<string, string>
}): Promise<SmileIdSubmission> {
  const cfg = smileIdConfig()
  if (!cfg) return { status: 'unavailable', error: 'SMILEID_PARTNER_ID / SMILEID_API_KEY not configured' }

  const country = (input.country ?? '').toUpperCase()
  if (!supportsEnhancedKyc(country)) {
    return { status: 'unavailable', error: `Enhanced KYC does not cover '${country}' (registry lookups: CI GH KE NG UG ZA ZM ZW)` }
  }

  const minted = await mintSmileIdToken({ product: 'enhanced_kyc', partnerParams: input.partnerParams })
  if (minted.status !== 'ok') return { status: 'unavailable', error: minted.error }

  // Wire format verified against sandbox 22 Jul 2026: the endpoint REQUIRES
  // multipart/form-data (415 on JSON, despite the docs' JSON schema), with
  // scalar fields at the top level and the object fields (user_details,
  // consent, partner_params) as JSON-string parts. Bracket-nested parts fail
  // validation ("consent is required").
  const fd = new FormData()
  fd.set('country', country)
  fd.set('id_type', input.idType)
  fd.set('id_number', input.idNumber)
  fd.set(
    'user_details',
    JSON.stringify({
      given_names: input.givenNames,
      last_name: input.lastName,
      email: input.email ?? null,
      phone_number: input.phoneNumber ?? null,
    })
  )
  fd.set(
    'consent',
    JSON.stringify({
      granted: true,
      granted_at: input.consent.grantedAt,
      notice_language: input.consent.noticeLanguage,
      notice_privacy_policy_url: input.consent.privacyPolicyUrl,
    })
  )
  if (input.callbackUrl) fd.set('callback_url', input.callbackUrl)
  if (input.partnerParams) fd.set('partner_params', JSON.stringify(input.partnerParams))

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const res = await fetch(`${cfg.baseUrl}/v3/enhanced_kyc`, {
      method: 'POST',
      // fetch sets the multipart boundary — never set Content-Type manually.
      headers: { 'SmileID-Partner-ID': cfg.partnerId, 'SmileID-Token': minted.token },
      body: fd,
      signal: controller.signal,
    })
    clearTimeout(timer)

    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      return { status: 'unavailable', error: `Non-JSON response (HTTP ${res.status})` }
    }
    const body = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
    if (res.status === 202 || asString(body.status) === 'accepted') {
      return { status: 'accepted', jobId: asString(body.job_id), smileUserId: asString(body.user_id) }
    }
    // Distinct ops failures — neither is ever a verdict on the person:
    // 402 = prepaid SmileID wallet exhausted; 403 = this id_type is not
    // enabled on our SmileID account (dashboard → ID API Status).
    if (res.status === 402) return { status: 'unavailable', error: 'SmileID wallet balance exhausted (HTTP 402)' }
    if (res.status === 403) {
      return { status: 'unavailable', error: `SmileID refused ${country}/${input.idType}: ${asString(body.message) ?? 'not enabled for this partner account'}` }
    }
    return { status: 'unavailable', error: `Enhanced KYC submit failed (HTTP ${res.status})` }
  } catch (err) {
    return { status: 'unavailable', error: err instanceof Error ? err.message : 'Network error' }
  }
}
