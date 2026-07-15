/**
 * PSP Adapter — canonical interfaces shared across all payment providers.
 *
 * Business logic imports these types (and functions) from '@/lib/psp' (web) or
 * '@ntzs/psp' (worker). Webhook handlers are PSP-specific by design and import
 * directly from their provider module (e.g. '@/lib/psp/snippe') to access
 * payload shapes and signature verification that differ per provider.
 *
 * Adding a new PSP:
 *   1. Create packages/psp/src/<provider>.ts implementing these interfaces.
 *   2. Register it in packages/psp/src/registry.ts (ADAPTERS) + add its PspId.
 *   3. Add the provider value to the psp_provider DB enum + migration.
 *   4. Wire up a new webhook handler at api/webhooks/<provider>/ and, if its
 *      callbacks are unreliable/success-only, a poll cron.
 */

// ─── Provider identity & routing ─────────────────────────────────────────────

/** PSPs with a live adapter in the registry. */
export type PspId = 'snippe' | 'azampay' | 'selcom'

/**
 * Every provider tag that can appear stamped on a historical record
 * (deposit_requests.payment_provider / burn_requests.payout_provider).
 * Superset of PspId; legacy tags have no registry adapter.
 */
export type ProviderTag = PspId | 'zenopay' | 'snippe_card' | 'bank_transfer'

/** Money-flow capabilities that route independently (psp_routing.capability). */
export type PspCapability =
  | 'collections_mobile'
  | 'collections_card'
  | 'payouts_mobile'
  | 'payouts_bank'

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
  /**
   * The PSP rejected this as a DUPLICATE of an earlier submission — meaning the
   * ORIGINAL was accepted and the money is in flight or already paid.
   *
   * ⚠ It arrives with success:false, but it is NOT a failed payout. Callers MUST
   * NOT revert / re-mint on it: that would hand the customer the fiat AND the
   * tokens and mint unbacked supply, breaking the 1:1 peg. Treat it as in-flight
   * and reconcile via status query or callback instead.
   *
   * Verified on AzamPay (2026-07-15): replaying an externalReferenceId returns
   * success:false "Detected duplicate transaction: Duplicate ExternalReferenceId"
   * and does NOT return the original pgReferenceId.
   */
  duplicate?: boolean
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
