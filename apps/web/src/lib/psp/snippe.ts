/**
 * Snippe PSP Client
 * Mobile Money Tanzania integration for nTZS deposits and payouts
 * Ported from proven PayPerPlay production code
 */

import crypto from 'crypto'

const SNIPPE_BASE_URL = 'https://api.snippe.sh'

function getApiKey(): string {
  const key = process.env.SNIPPE_API_KEY
  if (!key) throw new Error('SNIPPE_API_KEY is not configured')
  return key
}

function getWebhookSecret(): string {
  const secret = process.env.SNIPPE_WEBHOOK_SECRET
  if (!secret) throw new Error('SNIPPE_WEBHOOK_SECRET is not configured')
  return secret
}

// ─── Phone Normalization ────────────────────────────────────────────────────

/**
 * Normalize phone to 255XXXXXXXXX format (no + prefix) for Snippe
 */
export function normalizePhone(phone: string): string {
  let n = phone.replace(/[\s\-+]/g, '')
  if (n.startsWith('0')) {
    n = '255' + n.substring(1)
  }
  if (!n.startsWith('255')) {
    n = '255' + n
  }
  return n
}

/**
 * Validate a Tanzanian mobile money phone number
 */
export function isValidTanzanianPhone(phone: string): boolean {
  const normalized = normalizePhone(phone)
  // Must be 12 digits: 255 + 9 digits
  if (!/^255\d{9}$/.test(normalized)) return false
  // Valid mobile prefixes after 255
  const prefix = normalized.slice(3, 5)
  const validPrefixes = ['74', '75', '76', '77', '78', '68', '69', '71', '65', '67']
  return validPrefixes.includes(prefix)
}

// ─── Payment (Collection / On-Ramp) ────────────────────────────────────────

export interface SnippePaymentRequest {
  amountTzs: number
  phoneNumber: string
  customerEmail: string
  customerFirstname?: string
  customerLastname?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface SnippePaymentResponse {
  success: boolean
  reference?: string
  error?: string
}

/**
 * Initiate a mobile money payment via Snippe
 * POST /v1/payments
 */
export async function initiatePayment(
  request: SnippePaymentRequest
): Promise<SnippePaymentResponse> {
  const apiKey = getApiKey()
  const phone = normalizePhone(request.phoneNumber)

  try {
    const webhookEntry = request.webhookUrl?.startsWith('https://')
      ? { webhook_url: request.webhookUrl }
      : (() => {
          console.warn('[snippe] webhook_url not sent to Snippe — must be https. Got:', request.webhookUrl)
          return {}
        })()

    const response = await fetch(`${SNIPPE_BASE_URL}/v1/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payment_type: 'mobile',
        details: {
          amount: request.amountTzs,
          currency: 'TZS',
        },
        phone_number: phone,
        customer: {
          firstname: request.customerFirstname || 'nTZS',
          lastname: request.customerLastname || 'User',
          email: request.customerEmail,
        },
        ...webhookEntry,
        metadata: request.metadata,
      }),
    })

    const result = await response.json()

    if (result.status !== 'success' || !result.data?.reference) {
      console.error('[snippe] payment initiation failed — HTTP', response.status, result)
      
      // Detect provider outages
      const errorMsg = result.message || ''
      const isProviderOutage = 
        errorMsg.toLowerCase().includes('vodacom') ||
        errorMsg.toLowerCase().includes('provider') ||
        errorMsg.toLowerCase().includes('unavailable') ||
        errorMsg.toLowerCase().includes('temporarily')
      
      return {
        success: false,
        error: isProviderOutage 
          ? 'Mobile money service temporarily unavailable. Please try again later or use a different payment method.'
          : result.message || 'Payment initiation failed',
      }
    }

    console.log('[snippe] payment initiated:', {
      reference: result.data.reference,
      amount: request.amountTzs,
      phone,
    })

    return {
      success: true,
      reference: result.data.reference,
    }
  } catch (error) {
    console.error('[snippe] payment API error:', error)
    return {
      success: false,
      error: 'Failed to connect to payment provider',
    }
  }
}

// ─── Card Payment (Redirect Flow) ───────────────────────────────────────────

export interface SnippeCardPaymentRequest {
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

export interface SnippeCardPaymentResponse {
  success: boolean
  reference?: string
  paymentUrl?: string
  error?: string
}

/**
 * Initiate a card payment via Snippe — returns a payment_url to redirect the user to
 * POST /v1/payments (payment_type: "card")
 */
export async function initiateCardPayment(
  request: SnippeCardPaymentRequest
): Promise<SnippeCardPaymentResponse> {
  const apiKey = getApiKey()
  const phone = normalizePhone(request.phoneNumber)

  try {
    const response = await fetch(`${SNIPPE_BASE_URL}/v1/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payment_type: 'card',
        phone_number: phone,
        details: {
          amount: request.amountTzs,
          currency: 'TZS',
          redirect_url: request.redirectUrl,
          cancel_url: request.cancelUrl,
        },
        customer: {
          firstname: request.customerFirstname || 'nTZS',
          lastname: request.customerLastname || 'User',
          email: request.customerEmail,
          address: 'Tanzania',
          city: 'Dar es Salaam',
          state: 'DSM',
          postcode: '14101',
          country: 'TZ',
        },
        ...(request.webhookUrl?.startsWith('https://') ? { webhook_url: request.webhookUrl } : {}),
        metadata: request.metadata,
      }),
    })

    const result = await response.json()

    if (result.status !== 'success' || !result.data?.payment_url) {
      console.error('[snippe] card payment initiation failed:', result)
      return { success: false, error: result.message || 'Card payment initiation failed' }
    }

    console.log('[snippe] card payment initiated:', {
      reference: result.data.reference,
      amount: request.amountTzs,
    })

    return {
      success: true,
      reference: result.data.reference,
      paymentUrl: result.data.payment_url,
    }
  } catch (error) {
    console.error('[snippe] card payment API error:', error)
    return { success: false, error: 'Failed to connect to payment provider' }
  }
}

// ─── Payment Status Check ───────────────────────────────────────────────────

export interface SnippePaymentStatusResponse {
  status: 'completed' | 'pending' | 'failed' | 'expired' | 'voided'
  amount?: number
  completedAt?: string
}

/**
 * Check payment status via Snippe API
 * GET /v1/payments/{reference}
 */
export async function checkPaymentStatus(
  reference: string
): Promise<SnippePaymentStatusResponse> {
  const apiKey = getApiKey()

  try {
    const response = await fetch(`${SNIPPE_BASE_URL}/v1/payments/${reference}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    const result = await response.json()

    if (result.status !== 'success' || !result.data) {
      return { status: 'pending' }
    }

    return {
      status: result.data.status as SnippePaymentStatusResponse['status'],
      amount: result.data.amount?.value,
      completedAt: result.data.completed_at,
    }
  } catch (error) {
    console.error('[snippe] status check error:', error)
    return { status: 'pending' }
  }
}

// ─── Payout (Disbursement / Off-Ramp) ───────────────────────────────────────

export interface SnippePayoutRequest {
  amountTzs: number
  recipientPhone: string
  recipientName: string
  narration?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface SnippePayoutResponse {
  success: boolean
  reference?: string
  externalReference?: string
  fees?: number
  total?: number
  error?: string
  /**
   * Snippe error code (e.g. 'INT_003'). Populated on failures when Snippe
   * returned a structured error body.
   */
  errorCode?: string
}

/**
 * Transient Snippe error codes that are safe to retry. These are failures
 * where Snippe definitely did NOT dispatch the underlying payout (the
 * request didn't reach the mobile-money provider), so a retry cannot
 * cause a double-payout.
 *
 *   INT_003: "Provider temporarily unreachable" (most common — mobile
 *            network operator was unreachable from Snippe's end).
 *
 * Any other 4xx-style errors (insufficient float, invalid phone, etc.)
 * are NOT retried because they indicate a terminal condition or client
 * error that a retry won't fix.
 */
const RETRYABLE_SNIPPE_ERROR_CODES = new Set(['INT_003'])

function isRetryableResponse(result: {
  status?: string
  error_code?: string
  message?: string
}, httpStatus: number): boolean {
  if (httpStatus >= 500) return true
  if (result.error_code && RETRYABLE_SNIPPE_ERROR_CODES.has(result.error_code)) return true
  // Fall back to message pattern for when Snippe omits a code on transient failures.
  const msg = (result.message || '').toLowerCase()
  if (msg.includes('provider temporarily unreachable')) return true
  if (msg.includes('try again later')) return true
  return false
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Send a payout to a mobile money account via Snippe
 * POST /v1/payouts/send
 *
 * Automatically retries on transient errors (network failures, HTTP 5xx,
 * known transient Snippe error codes like INT_003). Retries are safe
 * because they only fire when Snippe definitely did not reach the
 * underlying mobile-money provider.
 */
export async function sendPayout(
  request: SnippePayoutRequest
): Promise<SnippePayoutResponse> {
  const apiKey = getApiKey()
  const phone = normalizePhone(request.recipientPhone)

  const MAX_ATTEMPTS = 3
  const BACKOFF_MS = [0, 1000, 3000] // immediate, +1s, +3s

  let lastError: string | undefined
  let lastErrorCode: string | undefined
  let lastReference: string | undefined
  let lastExternalReference: string | undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt] > 0) await sleep(BACKOFF_MS[attempt])

    try {
      const response = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: request.amountTzs,
          channel: 'mobile',
          recipient_phone: phone,
          recipient_name: request.recipientName,
          narration: request.narration || 'nTZS withdrawal',
          ...(request.webhookUrl?.startsWith('https://') ? { webhook_url: request.webhookUrl } : {}),
          metadata: request.metadata,
        }),
      })

      const result = await response.json()

      if (result.status === 'success' && result.data?.reference) {
        console.log('[snippe] payout initiated:', {
          reference: result.data.reference,
          amount: request.amountTzs,
          phone,
          fees: result.data.fees?.value,
          attempt: attempt + 1,
        })
        return {
          success: true,
          reference: result.data.reference,
          externalReference: result.data.external_reference,
          fees: result.data.fees?.value,
          total: result.data.total?.value,
        }
      }

      // Failed. Capture what we can for the caller / reconciler.
      lastError = result.message || 'Payout initiation failed'
      lastErrorCode = result.error_code
      lastReference = result.data?.reference
      lastExternalReference = result.data?.external_reference

      const retryable = isRetryableResponse(result, response.status)
      console.error('[snippe] payout failed', {
        attempt: attempt + 1,
        httpStatus: response.status,
        error: lastError,
        errorCode: lastErrorCode,
        retryable,
      })

      if (!retryable) break
    } catch (error) {
      // Network / fetch exception — retry
      lastError = error instanceof Error ? error.message : 'Failed to connect to payout provider'
      console.error('[snippe] payout fetch error', { attempt: attempt + 1, error: lastError })
    }
  }

  // IMPORTANT: capture reference/error_code even on terminal failure. Snippe's
  // dashboard often shows a reference for "failed at dispatch" cases —
  // without this we lose the only link we have to the payout record.
  return {
    success: false,
    error: lastError || 'Payout initiation failed',
    reference: lastReference,
    externalReference: lastExternalReference,
    errorCode: lastErrorCode,
  }
}

// ─── Payout Status Check ────────────────────────────────────────────────────

export interface SnippePayoutStatusResponse {
  status: 'completed' | 'failed' | 'reversed' | 'pending' | 'unknown'
  failureReason?: string
  completedAt?: string
}

/**
 * Check payout status via Snippe API
 * GET /v1/payouts/{reference}
 *
 * Used by the reconcile-stuck-burns cron to act authoritatively on burns
 * whose payout was initiated but whose webhook may have been missed.
 */
export async function checkPayoutStatus(
  reference: string
): Promise<SnippePayoutStatusResponse> {
  const apiKey = getApiKey()

  try {
    const response = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/${reference}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })

    const result = await response.json() as {
      status?: string
      data?: { status?: string; failure_reason?: string; completed_at?: string }
    }

    if (result.status !== 'success' || !result.data) {
      return { status: 'unknown' }
    }

    const s = String(result.data.status ?? '').toLowerCase()
    if (s === 'completed') return { status: 'completed', completedAt: result.data.completed_at }
    if (s === 'failed') return { status: 'failed', failureReason: result.data.failure_reason }
    if (s === 'reversed') return { status: 'reversed', failureReason: result.data.failure_reason }
    if (s === 'pending' || s === 'processing') return { status: 'pending' }
    return { status: 'unknown' }
  } catch (error) {
    console.error('[snippe] payout status check error:', error instanceof Error ? error.message : error)
    return { status: 'unknown' }
  }
}

// ─── Bank Payout (Disbursement to Bank Account) ─────────────────────────────

export interface SnippeBankPayoutRequest {
  amountTzs: number
  recipientName: string
  bankAccount: string
  bankName: string
  narration?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

/**
 * Send a payout to a bank account via Snippe
 * POST /v1/payouts/send  (channel: "bank")
 */
export async function sendBankPayout(
  request: SnippeBankPayoutRequest
): Promise<SnippePayoutResponse> {
  const apiKey = getApiKey()

  try {
    const response = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: request.amountTzs,
        channel: 'bank',
        recipient_name: request.recipientName,
        bank_account: request.bankAccount,
        bank_name: request.bankName,
        narration: request.narration || 'nTZS treasury withdrawal',
        ...(request.webhookUrl?.startsWith('https://') ? { webhook_url: request.webhookUrl } : {}),
        metadata: request.metadata,
      }),
    })

    const result = await response.json()

    if (result.status !== 'success' || !result.data?.reference) {
      console.error('[snippe] bank payout failed:', result)
      return {
        success: false,
        error: result.message || 'Bank payout initiation failed',
        reference: result.data?.reference,
        externalReference: result.data?.external_reference,
        errorCode: result.error_code,
      }
    }

    console.log('[snippe] bank payout initiated:', {
      reference: result.data.reference,
      amount: request.amountTzs,
      bank: request.bankName,
    })

    return {
      success: true,
      reference: result.data.reference,
      externalReference: result.data.external_reference,
      fees: result.data.fees?.value,
      total: result.data.total?.value,
    }
  } catch (error) {
    console.error('[snippe] bank payout API error:', error)
    return { success: false, error: 'Failed to connect to payout provider' }
  }
}

// ─── Account Balance ─────────────────────────────────────────────────────────

export interface SnippeBalanceResponse {
  available: number
  pending: number
  currency: string
}

/**
 * Fetch the Snippe account balance
 * GET /v1/payments/balance
 */
export async function getBalance(): Promise<SnippeBalanceResponse> {
  const apiKey = getApiKey()

  const response = await fetch(`${SNIPPE_BASE_URL}/v1/payments/balance`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })

  const result = await response.json()

  if (result.status !== 'success' || !result.data) {
    throw new Error(result.message || 'Failed to fetch Snippe balance')
  }

  return {
    available: result.data.available?.value ?? result.data.available ?? 0,
    pending: result.data.pending?.value ?? result.data.pending ?? 0,
    currency: result.data.currency ?? 'TZS',
  }
}

// ─── Payout Fee Calculation ─────────────────────────────────────────────────

export interface SnippePayoutFeeResponse {
  fee: number
  total: number
}

/**
 * Calculate payout fee before sending
 * GET /v1/payouts/fee?amount=X
 */
export async function calculatePayoutFee(
  amount: number
): Promise<SnippePayoutFeeResponse> {
  const apiKey = getApiKey()

  const response = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/fee?amount=${amount}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })

  const result = await response.json()

  if (result.status !== 'success' || !result.data) {
    throw new Error(result.message || 'Failed to calculate payout fee')
  }

  return {
    fee: result.data.fees?.value || 0,
    total: result.data.total?.value || amount,
  }
}

// ─── Webhook Signature Verification ─────────────────────────────────────────

export interface SnippePaymentWebhookPayload {
  type: 'payment.completed' | 'payment.failed'
  data: {
    reference: string
    external_reference?: string
    status: 'completed' | 'failed'
    amount: { value: number; currency: string }
    settlement?: { gross: { value: number }; fees: { value: number }; net: { value: number } }
    channel?: { type: string; provider: string }
    customer?: { phone: string; name: string; email: string }
    metadata?: Record<string, unknown>
    completed_at?: string
    failure_reason?: string
  }
}

export interface SnippePayoutWebhookPayload {
  type: 'payout.completed' | 'payout.failed'
  data: {
    reference: string
    status: 'completed' | 'failed'
    amount?: { value: number; currency: string }
    failure_reason?: string
    metadata?: Record<string, unknown>
  }
}

/**
 * Maximum age (seconds) for a signed webhook payload before we treat it as a replay.
 */
const WEBHOOK_MAX_SKEW_SECONDS = 5 * 60

/**
 * Verify webhook signature using HMAC-SHA256.
 * Snippe signs: HMAC-SHA256(secret, timestamp + "." + rawBody).
 * Fallback: HMAC-SHA256(secret, rawBody) — kept for backwards compatibility
 * with older Snippe deployments that omit the timestamp header.
 *
 * Returns false on any error (missing secret, bad signature, stale timestamp).
 * This function never throws — callers should treat `false` as "reject".
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp?: string
): boolean {
  if (!signature) return false

  let secret: string
  try {
    secret = getWebhookSecret()
  } catch {
    // Fail closed: a misconfigured server MUST NOT accept unsigned webhooks.
    console.error('[snippe] SNIPPE_WEBHOOK_SECRET is not configured — rejecting webhook')
    return false
  }

  // Primary: sign timestamp.body (Snippe's format). Enforce freshness.
  if (timestamp) {
    const ts = Number(timestamp)
    if (!Number.isFinite(ts)) return false
    const nowSec = Math.floor(Date.now() / 1000)
    // Snippe sends either seconds or milliseconds — normalise to seconds.
    const tsSec = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)
    if (Math.abs(nowSec - tsSec) > WEBHOOK_MAX_SKEW_SECONDS) {
      console.warn('[snippe] webhook timestamp outside allowed skew', { tsSec, nowSec })
      return false
    }

    const signedPayload = `${timestamp}.${rawBody}`
    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex')
    const sigBuf = Buffer.from(signature, 'utf8')
    const expBuf = Buffer.from(expected, 'utf8')
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      return true
    }
    // Fall through to body-only comparison for older Snippe signing mode.
  }

  // Fallback: sign body only (legacy). Without a timestamp we cannot detect
  // replays — only allow this path if the partner explicitly opts in via
  // SNIPPE_WEBHOOK_ALLOW_UNTIMED=1.
  if (!timestamp && process.env.SNIPPE_WEBHOOK_ALLOW_UNTIMED !== '1') {
    return false
  }

  const expectedBodyOnly = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')
  const sigBuf = Buffer.from(signature, 'utf8')
  const expBuf = Buffer.from(expectedBodyOnly, 'utf8')
  if (sigBuf.length !== expBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expBuf)
}
