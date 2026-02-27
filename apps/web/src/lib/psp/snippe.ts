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
        ...(request.webhookUrl?.startsWith('https://') ? { webhook_url: request.webhookUrl } : {}),
        metadata: request.metadata,
      }),
    })

    const result = await response.json()

    if (result.status !== 'success' || !result.data?.reference) {
      console.error('[snippe] payment initiation failed:', result)
      return {
        success: false,
        error: result.message || 'Payment initiation failed',
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
}

/**
 * Send a payout to a mobile money account via Snippe
 * POST /v1/payouts/send
 */
export async function sendPayout(
  request: SnippePayoutRequest
): Promise<SnippePayoutResponse> {
  const apiKey = getApiKey()
  const phone = normalizePhone(request.recipientPhone)

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

    if (result.status !== 'success' || !result.data?.reference) {
      console.error('[snippe] payout failed:', result)
      return {
        success: false,
        error: result.message || 'Payout initiation failed',
      }
    }

    console.log('[snippe] payout initiated:', {
      reference: result.data.reference,
      amount: request.amountTzs,
      phone,
      fees: result.data.fees?.value,
    })

    return {
      success: true,
      reference: result.data.reference,
      externalReference: result.data.external_reference,
      fees: result.data.fees?.value,
      total: result.data.total?.value,
    }
  } catch (error) {
    console.error('[snippe] payout API error:', error)
    return {
      success: false,
      error: 'Failed to connect to payout provider',
    }
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

// ─── Payout Status Check ────────────────────────────────────────────────────

export interface SnippePayoutStatusResponse {
  status: 'pending' | 'completed' | 'failed' | 'reversed'
  failureReason?: string
}

/**
 * Check payout status
 * GET /v1/payouts/{reference}
 */
export async function checkPayoutStatus(
  reference: string
): Promise<SnippePayoutStatusResponse> {
  const apiKey = getApiKey()

  try {
    const response = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/${reference}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    const result = await response.json()

    if (result.status !== 'success' || !result.data) {
      return { status: 'pending' }
    }

    return {
      status: result.data.status as SnippePayoutStatusResponse['status'],
      failureReason: result.data.failure_reason,
    }
  } catch (error) {
    console.error('[snippe] payout status error:', error)
    return { status: 'pending' }
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
 * Verify webhook signature using HMAC-SHA256
 * Snippe signs: HMAC-SHA256(secret, timestamp + "." + rawBody)
 * Fallback: HMAC-SHA256(secret, rawBody)
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp?: string
): boolean {
  const secret = getWebhookSecret()

  // Primary: sign timestamp.body (Snippe's format)
  if (timestamp) {
    const signedPayload = `${timestamp}.${rawBody}`
    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex')
    try {
      if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return true
      }
    } catch { /* length mismatch, try fallback */ }
  }

  // Fallback: sign body only
  const expectedBodyOnly = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedBodyOnly),
    )
  } catch {
    return false
  }
}
