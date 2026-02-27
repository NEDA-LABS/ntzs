/**
 * ZenoPay API Client
 * Mobile Money Tanzania integration for nTZS deposits
 *
 * PSP ABSTRACTION — the UI references ACTIVE_PSP_NAME, not "ZenoPay" directly.
 * To swap providers (e.g. Azam, Selcom), update ACTIVE_PSP_NAME and point the
 * functions below to the new provider's API. The UI and DB schema need no changes.
 */

export const ACTIVE_PSP_NAME = process.env.ACTIVE_PSP_NAME || 'Snippe'
export const ACTIVE_PSP_METHOD_LABEL = 'Mobile Money'

const ZENOPAY_API_URL = process.env.ZENOPAY_API_URL || 'https://api.zeno.africa'
const ZENOPAY_API_KEY = process.env.ZENOPAY_API_KEY || ''

export interface ZenoPayPaymentRequest {
  order_id: string
  buyer_email: string
  buyer_name: string
  buyer_phone: string
  amount: number
  webhook_url?: string
}

export interface ZenoPayPaymentResponse {
  status: 'success' | 'error'
  resultcode?: string
  message: string
  order_id?: string
}

export interface ZenoPayOrderStatusResponse {
  reference: string
  resultcode: string
  result: 'SUCCESS' | 'FAILED' | 'PENDING'
  message: string
  data: Array<{
    order_id: string
    creation_date: string
    amount: string
    payment_status: 'COMPLETED' | 'PENDING' | 'FAILED'
    transid: string
    channel: string
    reference: string
    msisdn: string
  }>
}

export interface ZenoPayWebhookPayload {
  order_id: string
  payment_status: 'COMPLETED' | 'PENDING' | 'FAILED'
  reference: string
  transid?: string
  channel?: string
  amount?: string
  metadata?: Record<string, unknown>
}

/**
 * Initiate a Mobile Money payment via ZenoPay
 */
export async function createZenoPayPayment(
  request: ZenoPayPaymentRequest
): Promise<ZenoPayPaymentResponse> {
  if (!ZENOPAY_API_KEY) {
    throw new Error('ZENOPAY_API_KEY is not configured')
  }

  const response = await fetch(`${ZENOPAY_API_URL}/payments/mobile_money_tanzania`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ZENOPAY_API_KEY,
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`ZenoPay API error: ${response.status} - ${text}`)
  }

  return response.json()
}

/**
 * Check the status of a ZenoPay order
 */
export async function getZenoPayOrderStatus(
  orderId: string
): Promise<ZenoPayOrderStatusResponse> {
  if (!ZENOPAY_API_KEY) {
    throw new Error('ZENOPAY_API_KEY is not configured')
  }

  const response = await fetch(
    `https://api.zeno.africa/order-status?order_id=${encodeURIComponent(orderId)}`,
    {
      method: 'GET',
      headers: {
        'x-api-key': ZENOPAY_API_KEY,
      },
    }
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`ZenoPay API error: ${response.status} - ${text}`)
  }

  return response.json()
}

/**
 * Verify that a webhook request is authentic
 */
export function verifyZenoPayWebhook(apiKeyHeader: string | null): boolean {
  if (!ZENOPAY_API_KEY) {
    console.error('ZENOPAY_API_KEY is not configured for webhook verification')
    return false
  }

  return apiKeyHeader === ZENOPAY_API_KEY
}

/**
 * Format a Tanzanian phone number to the format ZenoPay expects (07XXXXXXXX)
 */
export function formatTanzanianPhone(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '')

  // Handle different formats
  if (digits.startsWith('255') && digits.length === 12) {
    // +255XXXXXXXXX -> 0XXXXXXXXX
    return '0' + digits.slice(3)
  }

  if (digits.startsWith('0') && digits.length === 10) {
    // Already in correct format
    return digits
  }

  if (digits.length === 9) {
    // XXXXXXXXX -> 0XXXXXXXXX
    return '0' + digits
  }

  // Return as-is if we can't normalize
  return phone
}

/**
 * Validate a Tanzanian mobile money phone number
 */
export function isValidTanzanianMobileNumber(phone: string): boolean {
  const formatted = formatTanzanianPhone(phone)
  
  // Must be 10 digits starting with 07
  if (!/^07\d{8}$/.test(formatted)) {
    return false
  }

  // Valid prefixes for M-Pesa (Vodacom), Tigo Pesa, Airtel Money, Halotel
  const validPrefixes = ['074', '075', '076', '077', '078', '068', '069', '071', '065', '067']
  const prefix = formatted.slice(0, 3)

  return validPrefixes.includes(prefix)
}
