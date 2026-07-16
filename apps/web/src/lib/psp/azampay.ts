/**
 * AzamPay PSP Client
 * Mobile Money Tanzania — on-ramp (MNO checkout) and off-ramp (disbursement)
 *
 * Key differences from Snippe:
 * - Auth: JWT fetched per session and cached (not a static API key)
 * - MNO checkout: no provider field sent — AzamPay auto-detects from phone
 * - Status check: requires transactionId + provider enum (store as pspChannel)
 * - Disbursement: must specify source float bank (NMB or CRDB via AZAMPAY_BANK_NAME)
 * - Name lookup: pre-deposit (getuserinfo) + pre-payout (namelookup)
 *
 * Sandbox Swagger: https://sandbox.azampay.co.tz/swagger/v1/swagger.json
 */

import crypto from 'crypto'

import {
  azamBankNameForNetwork,
  azamPayChecksumKey,
  buildDisbursementChecksumInput,
  buildNameLookupChecksumInput,
  computeAzamPayChecksum,
} from './azampay-checksum'
import { detectNetwork } from './routing'

// ─── Config ───────────────────────────────────────────────────────────────────

function getAzamPayEnv(): 'sandbox' | 'production' {
  return process.env.AZAMPAY_ENV === 'production' ? 'production' : 'sandbox'
}

function getAuthBase(): string {
  return getAzamPayEnv() === 'production'
    ? 'https://authenticator.azampay.co.tz'
    : 'https://authenticator-sandbox.azampay.co.tz'
}

function getCheckoutBase(): string {
  return getAzamPayEnv() === 'production'
    ? 'https://checkout.azampay.co.tz'
    : 'https://sandbox.azampay.co.tz'
}

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`${key} is not configured`)
  return v
}

function getBankName(): string {
  return process.env.AZAMPAY_BANK_NAME || 'nmb'
}

// ─── JWT Token Cache ──────────────────────────────────────────────────────────

let tokenCache: { accessToken: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken
  }

  const response = await fetch(`${getAuthBase()}/AppRegistration/GenerateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appName: requireEnv('AZAMPAY_APP_NAME'),
      clientId: requireEnv('AZAMPAY_CLIENT_ID'),
      clientSecret: requireEnv('AZAMPAY_CLIENT_SECRET'),
    }),
    signal: AbortSignal.timeout(10_000),
  })

  const result = await response.json() as {
    success?: boolean
    message?: string
    data?: { accessToken?: string; expire?: string; expireAt?: string }
  }

  if (!result.success || !result.data?.accessToken) {
    throw new Error(`AzamPay auth failed: ${result.message ?? 'unknown error'}`)
  }

  // Sandbox returns 'expire'; production may use 'expireAt' — handle both
  const expireStr = result.data.expire ?? result.data.expireAt
  const expiresAt = expireStr
    ? new Date(expireStr).getTime()
    : Date.now() + 55 * 60 * 1000

  tokenCache = { accessToken: result.data.accessToken, expiresAt }
  return tokenCache.accessToken
}

// ─── Phone Normalization + MNO Detection ─────────────────────────────────────

export function normalizePhone(phone: string): string {
  let n = phone.replace(/[\s\-+]/g, '')
  if (n.startsWith('0')) n = '255' + n.substring(1)
  if (!n.startsWith('255')) n = '255' + n
  return n
}

export function isValidTanzanianPhone(phone: string): boolean {
  const normalized = normalizePhone(phone)
  if (!/^255\d{9}$/.test(normalized)) return false
  const prefix = normalized.slice(3, 5)
  const validPrefixes = ['74', '75', '76', '77', '78', '68', '69', '71', '65', '67']
  return validPrefixes.includes(prefix)
}

/**
 * Map Tanzanian phone prefix → AzamPay provider enum value.
 * AzamPay auto-detects provider at checkout but the caller must supply it
 * for status queries and name lookups — stored as pspChannel in the DB.
 *
 * ⚠ Verify prefix→provider mappings against AzamPay sandbox documentation.
 * Provider enum: azampesa | airtel | tigo | halopesa | nmb | crdb
 */
export function detectAzamPayProvider(normalizedPhone: string): string {
  const prefix = normalizedPhone.slice(3, 5)
  if (['74', '75', '76'].includes(prefix)) return 'azampesa' // Vodacom M-PESA
  if (['68', '69', '78'].includes(prefix)) return 'airtel'
  if (['71', '65'].includes(prefix))       return 'tigo'
  if (['62'].includes(prefix))             return 'halopesa'
  return 'azampesa'
}

// ─── Name Lookup — Collection Side ───────────────────────────────────────────

export interface AzamPayAccountInfo {
  name: string | null
  phone: string
}

/**
 * Look up the registered name on a mobile money account before deposit.
 * Shown on the deposit form as "Paying as: John Doe" so the user can confirm.
 * Never throws — returns { name: null } on any failure.
 *
 * POST /api/v1/azampesa/getuserinfo
 * ⚠ Verify response field paths (name vs fullName vs firstName/lastName) in sandbox.
 */
export async function lookupAccountName(phone: string): Promise<AzamPayAccountInfo> {
  const normalized = normalizePhone(phone)
  try {
    const token = await getAccessToken()
    const response = await fetch(`${getCheckoutBase()}/api/v1/azampesa/getuserinfo`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ Phone: normalized, Language: 'EN' }),
      signal: AbortSignal.timeout(8_000),
    })

    const result = await response.json() as {
      success?: boolean
      data?: { name?: string; fullName?: string; firstName?: string; lastName?: string }
    }

    if (!result.success || !result.data) return { name: null, phone: normalized }

    const d = result.data
    const name = (d.name ?? d.fullName ?? [d.firstName, d.lastName].filter(Boolean).join(' ')) || null
    return { name, phone: normalized }
  } catch (err) {
    console.warn('[azampay] lookupAccountName failed (non-fatal):', err instanceof Error ? err.message : err)
    return { name: null, phone: normalized }
  }
}

// ─── Payment (Collection / On-Ramp) ──────────────────────────────────────────

export interface AzamPayPaymentRequest {
  amountTzs: number
  phoneNumber: string
  customerEmail: string
  customerFirstname?: string
  customerLastname?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface AzamPayPaymentResponse {
  success: boolean
  reference?: string
  provider?: string // detected MNO — caller stores as pspChannel
  error?: string
}

/**
 * Initiate a mobile money payment via AzamPay MNO Checkout.
 * POST /api/v1/checkout/checkoutmno
 *
 * No provider field is sent — AzamPay auto-detects from accountNumber.
 * We generate a UUID as externalId (stored as pspReference) so we can
 * correlate webhooks and status polls back to the deposit request.
 * detectAzamPayProvider() result is returned as `provider` so the caller
 * can store it as pspChannel for later status queries.
 *
 * ⚠ Verify whether amount must be a string or number in sandbox.
 */
export async function initiatePayment(
  request: AzamPayPaymentRequest
): Promise<AzamPayPaymentResponse> {
  const phone = normalizePhone(request.phoneNumber)
  const provider = detectAzamPayProvider(phone)
  const externalId = crypto.randomUUID()

  try {
    const token = await getAccessToken()

    const webhookEntry = request.webhookUrl?.startsWith('https://')
      ? { additionalProperties: { ...request.metadata, webhookUrl: request.webhookUrl } }
      : (() => {
          console.warn('[azampay] webhookUrl not sent — must be https. Got:', request.webhookUrl)
          return { additionalProperties: request.metadata }
        })()

    const response = await fetch(`${getCheckoutBase()}/api/v1/checkout/checkoutmno`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accountNumber: phone,
        amount: String(request.amountTzs),
        currency: 'TZS',
        externalId,
        provider,
        ...webhookEntry,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    const result = await response.json() as {
      success?: boolean
      transactionId?: string
      message?: string
      messageCode?: number
    }

    if (!result.success) {
      console.error('[azampay] payment initiation failed — HTTP', response.status, result)
      return { success: false, error: result.message || 'Payment initiation failed' }
    }

    // Store AzamPay's transactionId as reference (used for status checks), fall back to externalId
    const reference = result.transactionId && result.transactionId !== 'null' ? result.transactionId : externalId
    console.log('[azampay] payment initiated:', { reference, externalId, amount: request.amountTzs, phone, provider })
    return { success: true, reference, provider }
  } catch (err) {
    console.error('[azampay] payment API error:', err)
    return { success: false, error: 'Failed to connect to payment provider' }
  }
}

// ─── Card Payment ─────────────────────────────────────────────────────────────

// AzamPay card/bank checkout (OTP-based) is not in scope for this phase.
// Card payments continue to route through Snippe (see lib/psp/index.ts).
// The AzamPay bank checkout flow (verifybank → checkoutbank) will be
// implemented in a follow-up once tested in sandbox.
export async function initiateCardPayment(): Promise<never> {
  throw new Error('[azampay] Card payments are handled by Snippe — this function should not be called')
}

// ─── Payment Status Check ─────────────────────────────────────────────────────

export interface AzamPayPaymentStatusResponse {
  status: 'completed' | 'pending' | 'failed' | 'expired' | 'voided'
  amount?: number
  completedAt?: string
}

/**
 * Check payment status via AzamPay.
 * GET /api/v1/partner/gettransactionstatus?transactionId=&provider=
 * Response: { data: "success"|"pending"|"failed"|..., success: boolean }
 *
 * `provider` is the AzamPay provider enum stored at initiation as pspChannel.
 */
export async function checkPaymentStatus(
  reference: string,
  provider?: string
): Promise<AzamPayPaymentStatusResponse> {
  try {
    const token = await getAccessToken()
    const url = new URL(`${getCheckoutBase()}/api/v1/partner/gettransactionstatus`)
    url.searchParams.set('transactionId', reference)
    url.searchParams.set('provider', provider || 'azampesa')

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })

    const result = await response.json() as {
      success?: boolean
      data?: string
      statusCode?: number
    }

    if (!result.success) return { status: 'pending' }

    const s = String(result.data ?? '').toLowerCase()
    if (s === 'success' || s === 'completed') return { status: 'completed' }
    if (s === 'failed' || s === 'failure' || s === 'reversed') return { status: 'failed' }
    if (s === 'expired') return { status: 'expired' }
    return { status: 'pending' }
  } catch (err) {
    console.error('[azampay] status check error:', err instanceof Error ? err.message : err)
    return { status: 'pending' }
  }
}

// ─── Name Lookup — Payout Side ────────────────────────────────────────────────

export interface AzamPayRecipientInfo {
  name: string | null
  idNumber?: string
}

/**
 * Verify the registered name on a mobile money account before disbursement.
 * Called before sendPayout() — result logged in audit trail.
 * Never throws — returns { name: null } on any failure.
 *
 * POST /api/v1/disbursement/namelookup
 * ⚠ Verify request body field names and `type` value for mobile in sandbox.
 */
export async function lookupRecipientName(phone: string): Promise<AzamPayRecipientInfo> {
  const normalized = normalizePhone(phone)
  const provider = detectAzamPayProvider(normalized)
  const bankName = azamBankNameForNetwork(detectNetwork(normalized))

  // Production requires a checksum over bankName + accountNumber (their
  // sample, 16 Jul 2026); omitted when the key isn't configured (sandbox).
  const checksumKey = azamPayChecksumKey()
  const checksumFields = checksumKey
    ? { checksum: computeAzamPayChecksum(buildNameLookupChecksumInput(bankName, normalized), checksumKey) }
    : {}

  try {
    const token = await getAccessToken()
    const response = await fetch(`${getCheckoutBase()}/api/v1/disbursement/namelookup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bankName,
        accountNumber: normalized,
        provider,
        type: 'mno', // ⚠ verify correct value for mobile money in sandbox
        ...checksumFields,
      }),
      signal: AbortSignal.timeout(8_000),
    })

    const result = await response.json() as {
      status?: boolean
      name?: string
      fName?: string
      lName?: string
      idNumber?: string
      message?: string
    }

    if (!result.status) return { name: null }

    const name = (result.name ?? [result.fName, result.lName].filter(Boolean).join(' ')) || null
    return { name, idNumber: result.idNumber }
  } catch (err) {
    console.warn('[azampay] lookupRecipientName failed (non-fatal):', err instanceof Error ? err.message : err)
    return { name: null }
  }
}

// ─── Payout (Disbursement / Off-Ramp) ────────────────────────────────────────

export interface AzamPayPayoutRequest {
  amountTzs: number
  recipientPhone: string
  recipientName: string
  narration?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface AzamPayPayoutResponse {
  success: boolean
  reference?: string
  externalReference?: string
  fees?: number
  total?: number
  error?: string
  errorCode?: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function isAzamPayTransientError(result: { success?: boolean; message?: string }, httpStatus: number): boolean {
  if (httpStatus >= 500) return true
  const msg = (result.message || '').toLowerCase()
  return msg.includes('temporarily') || msg.includes('unavailable') || msg.includes('try again')
}

/**
 * Send a payout to a mobile money account via AzamPay.
 * POST /api/v1/disbursement/disburse
 *
 * Retries on transient failures (HTTP 5xx, known transient messages).
 * Retries are safe — they only fire when AzamPay did not reach the MNO.
 *
 * Float bank sourced from AZAMPAY_BANK_NAME ('nmb' | 'crdb').
 *
 * ⚠ Verify exact nested structure of source/destination/transferDetails in sandbox.
 */
export async function sendPayout(request: AzamPayPayoutRequest): Promise<AzamPayPayoutResponse> {
  const phone = normalizePhone(request.recipientPhone)
  const provider = detectAzamPayProvider(phone)
  const bankName = getBankName()
  const destBankName = azamBankNameForNetwork(detectNetwork(phone))

  // ONE reference per logical payout, reused across retries. AzamPay rejects
  // duplicate externalReferenceIds — that rejection is the double-pay guard,
  // and it only protects us if a retry after a timeout carries the SAME
  // reference as the attempt that may have landed.
  const externalReferenceId = crypto.randomUUID()

  // Production checksum (their sample, 16 Jul 2026): SHA-512 of
  // sourceAcc+destAcc+currency+amount+epochSeconds+externalReferenceId,
  // RSA-PKCS#1-encrypted with their public key, base64. Skipped when the key
  // isn't configured (sandbox accepts requests without it).
  const checksumKey = azamPayChecksumKey()
  const sourceAcc = process.env.AZAMPAY_SOURCE_ACCOUNT || ''
  const epochSeconds = Math.floor(Date.now() / 1000)
  const checksumFields =
    checksumKey && sourceAcc
      ? {
          epochDate: epochSeconds,
          checksum: computeAzamPayChecksum(
            buildDisbursementChecksumInput({
              sourceAcc,
              destAcc: phone,
              currency: 'TZS',
              amount: String(Math.trunc(request.amountTzs)),
              epochSeconds,
              externalReferenceId,
            }),
            checksumKey
          ),
        }
      : {}

  const MAX_ATTEMPTS = 3
  const BACKOFF_MS = [0, 1000, 3000]

  let lastError: string | undefined
  let lastReference: string | undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt] > 0) await sleep(BACKOFF_MS[attempt])

    try {
      const token = await getAccessToken()

      const response = await fetch(`${getCheckoutBase()}/api/v1/disbursement/disburse`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        // ⚠ exact field names for checksum/epochDate to be confirmed against
        // AzamPay's production schema before enabling disbursements.
        body: JSON.stringify({
          source: { bankName },
          destination: { phone, provider, bankName: destBankName },
          transferDetails: { amount: request.amountTzs, currency: 'TZS' },
          externalReferenceId,
          remarks: request.narration || 'nTZS withdrawal',
          ...checksumFields,
          additionalProperties: {
            ...request.metadata,
            ...(request.webhookUrl?.startsWith('https://') ? { webhookUrl: request.webhookUrl } : {}),
          },
        }),
      })

      const result = await response.json() as {
        success?: boolean
        transactionId?: string
        message?: string
        type?: string
      }

      if (result.success && result.transactionId) {
        console.log('[azampay] payout initiated:', {
          transactionId: result.transactionId,
          amount: request.amountTzs,
          phone,
          bankName,
          attempt: attempt + 1,
        })
        return { success: true, reference: result.transactionId }
      }

      lastError = result.message || 'Payout initiation failed'
      lastReference = result.transactionId

      const retryable = isAzamPayTransientError(result, response.status)
      console.error('[azampay] payout failed', { attempt: attempt + 1, httpStatus: response.status, error: lastError, retryable })
      if (!retryable) break
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Failed to connect to payout provider'
      console.error('[azampay] payout fetch error', { attempt: attempt + 1, error: lastError })
    }
  }

  return { success: false, error: lastError || 'Payout initiation failed', reference: lastReference }
}

// ─── Bank Payout ──────────────────────────────────────────────────────────────

export interface AzamPayBankPayoutRequest {
  amountTzs: number
  recipientName: string
  bankAccount: string
  bankName: string
  narration?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

/**
 * Send a payout to a bank account via AzamPay.
 * POST /api/v1/disbursement/disburse (bank destination variant)
 * ⚠ Verify bank destination field names in sandbox.
 */
export async function sendBankPayout(request: AzamPayBankPayoutRequest): Promise<AzamPayPayoutResponse> {
  try {
    const token = await getAccessToken()

    const response = await fetch(`${getCheckoutBase()}/api/v1/disbursement/disburse`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: { bankName: getBankName() },
        destination: {
          bankAccount: request.bankAccount,
          bankName: request.bankName,
          recipientName: request.recipientName,
        },
        transferDetails: { amount: request.amountTzs, currency: 'TZS' },
        externalReferenceId: crypto.randomUUID(),
        remarks: request.narration || 'nTZS treasury withdrawal',
        additionalProperties: {
          ...request.metadata,
          ...(request.webhookUrl?.startsWith('https://') ? { webhookUrl: request.webhookUrl } : {}),
        },
      }),
    })

    const result = await response.json() as { success?: boolean; transactionId?: string; message?: string }

    if (!result.success || !result.transactionId) {
      console.error('[azampay] bank payout failed:', result)
      return { success: false, error: result.message || 'Bank payout initiation failed', reference: result.transactionId }
    }

    console.log('[azampay] bank payout initiated:', { transactionId: result.transactionId, amount: request.amountTzs })
    return { success: true, reference: result.transactionId }
  } catch (err) {
    console.error('[azampay] bank payout API error:', err)
    return { success: false, error: 'Failed to connect to payout provider' }
  }
}

// ─── Payout Status Check ──────────────────────────────────────────────────────

export interface AzamPayPayoutStatusResponse {
  status: 'completed' | 'failed' | 'reversed' | 'pending' | 'unknown'
  failureReason?: string
  completedAt?: string
}

/**
 * Check payout status via AzamPay.
 * GET /api/v1/disbursement/gettransactionstatus?pgReferenceId=&bankName=
 */
export async function checkPayoutStatus(reference: string): Promise<AzamPayPayoutStatusResponse> {
  try {
    const token = await getAccessToken()
    const url = new URL(`${getCheckoutBase()}/api/v1/disbursement/gettransactionstatus`)
    url.searchParams.set('pgReferenceId', reference)
    url.searchParams.set('bankName', getBankName())

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })

    const result = await response.json() as {
      success?: boolean
      data?: { status?: string; message?: string; completedAt?: string }
    }

    if (!result.success || !result.data) return { status: 'unknown' }

    const s = String(result.data.status ?? '').toLowerCase()
    if (s === 'success' || s === 'completed') return { status: 'completed', completedAt: result.data.completedAt }
    if (s === 'failed' || s === 'failure') return { status: 'failed', failureReason: result.data.message }
    if (s === 'reversed') return { status: 'reversed', failureReason: result.data.message }
    if (s === 'pending' || s === 'processing') return { status: 'pending' }
    return { status: 'unknown' }
  } catch (err) {
    console.error('[azampay] payout status check error:', err instanceof Error ? err.message : err)
    return { status: 'unknown' }
  }
}

// ─── Account Balance ──────────────────────────────────────────────────────────

export interface AzamPayBalanceResponse {
  available: number
  pending: number
  currency: string
}

/**
 * Fetch AzamPay float balance for the configured bank (AZAMPAY_BANK_NAME).
 * GET /api/v1/disbursement/checkbalance?bankName=
 * ⚠ Verify response field names (availableBalance vs balance) in sandbox.
 */
export async function getBalance(): Promise<AzamPayBalanceResponse> {
  const token = await getAccessToken()
  const url = new URL(`${getCheckoutBase()}/api/v1/disbursement/checkbalance`)
  url.searchParams.set('bankName', getBankName())

  const response = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  const result = await response.json() as {
    success?: boolean
    message?: string
    data?: { availableBalance?: number; pendingBalance?: number; balance?: number; currency?: string }
  }

  if (!result.success || !result.data) {
    throw new Error(result.message || 'Failed to fetch AzamPay balance')
  }

  return {
    available: result.data.availableBalance ?? result.data.balance ?? 0,
    pending: result.data.pendingBalance ?? 0,
    currency: result.data.currency ?? 'TZS',
  }
}

// ─── Payout Fee Calculation ───────────────────────────────────────────────────

export interface AzamPayPayoutFeeResponse {
  fee: number
  total: number
}

/**
 * AzamPay does not expose a public fee-calculation endpoint.
 * ⚠ Contact AzamPay to confirm fee structure and replace this stub.
 */
export async function calculatePayoutFee(amount: number): Promise<AzamPayPayoutFeeResponse> {
  console.warn('[azampay] calculatePayoutFee: stub — confirm fee structure with AzamPay')
  return { fee: 0, total: amount }
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

export interface AzamPayPaymentWebhookPayload {
  // ⚠ Field names must be verified against live AzamPay sandbox webhook deliveries.
  // These are provisional based on the pattern used by similar PSPs — update
  // once sandbox webhook events are observed.
  type?: string               // e.g. 'payment.completed' | 'payment.failed' — ⚠ verify
  transactionId?: string
  externalId?: string         // our externalId / pspReference
  status?: string             // e.g. 'SUCCESS' | 'FAILED' — ⚠ verify exact values
  amount?: number | string
  currency?: string
  provider?: string
  metadata?: Record<string, unknown>
  additionalProperties?: Record<string, unknown>
  failureReason?: string
  transactionDate?: string
}

export interface AzamPayPayoutWebhookPayload {
  // ⚠ Field names must be verified against live AzamPay sandbox payout webhooks.
  type?: string
  transactionId?: string
  status?: string
  amount?: number | string
  failureReason?: string
  metadata?: Record<string, unknown>
  additionalProperties?: Record<string, unknown>
}

const WEBHOOK_MAX_SKEW_SECONDS = 5 * 60

/**
 * Verify AzamPay webhook signature.
 *
 * ⚠ AzamPay's exact signing scheme MUST be verified in the sandbox portal.
 * This implementation assumes HMAC-SHA256 with a shared secret and
 * timestamp anti-replay protection (same scheme as Snippe).
 * Update the header names and signing format once confirmed.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp?: string
): boolean {
  if (!signature) return false

  let secret: string
  try {
    secret = requireEnv('AZAMPAY_WEBHOOK_SECRET')
  } catch {
    console.error('[azampay] AZAMPAY_WEBHOOK_SECRET is not configured — rejecting webhook')
    return false
  }

  if (timestamp) {
    const ts = Number(timestamp)
    if (!Number.isFinite(ts)) return false
    const nowSec = Math.floor(Date.now() / 1000)
    const tsSec = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)
    if (Math.abs(nowSec - tsSec) > WEBHOOK_MAX_SKEW_SECONDS) {
      console.warn('[azampay] webhook timestamp outside allowed skew', { tsSec, nowSec })
      return false
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex')
    const sigBuf = Buffer.from(signature, 'utf8')
    const expBuf = Buffer.from(expected, 'utf8')
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) return true
  }

  if (!timestamp && process.env.AZAMPAY_WEBHOOK_ALLOW_UNTIMED !== '1') return false

  const expectedBodyOnly = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const sigBuf = Buffer.from(signature, 'utf8')
  const expBuf = Buffer.from(expectedBodyOnly, 'utf8')
  if (sigBuf.length !== expBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expBuf)
}
