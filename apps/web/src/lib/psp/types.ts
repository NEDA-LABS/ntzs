/**
 * PSP Adapter — canonical interfaces shared across all payment providers.
 *
 * Business logic imports these types (and functions) from '@/lib/psp'.
 * Webhook handlers are PSP-specific by design and import directly from
 * their provider module (e.g. '@/lib/psp/snippe') to access payload shapes
 * and signature verification that differ per provider.
 *
 * Adding a new PSP:
 *   1. Create apps/web/src/lib/psp/<provider>.ts implementing these interfaces.
 *   2. Update lib/psp/index.ts to re-export from the new provider.
 *   3. Add the provider value to the psp_provider DB enum + migration.
 *   4. Wire up a new webhook handler at api/webhooks/<provider>/.
 */

// ─── On-ramp (collection / deposit) ─────────────────────────────────────────

export interface PaymentRequest {
  amountTzs: number
  phoneNumber: string
  customerEmail: string
  customerFirstname?: string
  customerLastname?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface PaymentResponse {
  success: boolean
  reference?: string
  /** Our own idempotency reference sent to the PSP (AzamPay externalId) — persisted for callback matching. */
  externalId?: string
  error?: string
}

export interface CardPaymentRequest {
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

export interface CardPaymentResponse {
  success: boolean
  reference?: string
  paymentUrl?: string
  error?: string
}

export interface PaymentStatusResponse {
  status: 'completed' | 'pending' | 'failed' | 'expired' | 'voided'
  amount?: number
  completedAt?: string
}

// ─── Off-ramp (payout / redemption) ──────────────────────────────────────────

export interface PayoutRequest {
  amountTzs: number
  recipientPhone: string
  recipientName: string
  narration?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface PayoutResponse {
  success: boolean
  reference?: string
  externalReference?: string
  fees?: number
  total?: number
  error?: string
  errorCode?: string
}

export interface BankPayoutRequest {
  amountTzs: number
  recipientName: string
  bankAccount: string
  bankName: string
  narration?: string
  webhookUrl: string
  metadata: Record<string, unknown>
}

export interface PayoutStatusResponse {
  status: 'completed' | 'failed' | 'reversed' | 'pending' | 'unknown'
  failureReason?: string
  completedAt?: string
}

// ─── Account ──────────────────────────────────────────────────────────────────

export interface BalanceResponse {
  available: number
  pending: number
  currency: string
}

export interface PayoutFeeResponse {
  fee: number
  total: number
}
