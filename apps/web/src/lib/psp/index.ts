/**
 * PSP entry point — all business logic imports PSP functions from here,
 * never directly from a provider module.
 *
 * Active PSP: Snippe (mobile money + card, Tanzania)
 * Legacy PSP: ZenoPay (deprecated — historical records only, webhook handler kept alive)
 *
 * To switch provider: update the re-exports below to point at the new module.
 * Webhook handlers are deliberately provider-bound and are updated separately.
 */

// ─── Active PSP identity ──────────────────────────────────────────────────────

/** Human-readable label shown in UI and logs. Override via ACTIVE_PSP_NAME env var. */
export const ACTIVE_PSP_NAME = process.env.ACTIVE_PSP_NAME || 'Snippe'

/** Value written to the psp_provider DB column for new transactions. */
export const ACTIVE_PSP_PROVIDER = 'snippe' as const

/** Human-readable payment method label for UI. */
export const ACTIVE_PSP_METHOD_LABEL = 'Mobile Money'

// ─── Canonical types ──────────────────────────────────────────────────────────

export type {
  PaymentRequest,
  PaymentResponse,
  CardPaymentRequest,
  CardPaymentResponse,
  PaymentStatusResponse,
  PayoutRequest,
  PayoutResponse,
  BankPayoutRequest,
  PayoutStatusResponse,
  BalanceResponse,
  PayoutFeeResponse,
} from './types'

// ─── Active PSP functions ─────────────────────────────────────────────────────
// Changing provider: swap these imports to the new provider's module.

export {
  normalizePhone,
  isValidTanzanianPhone,
  initiatePayment,
  initiateCardPayment,
  checkPaymentStatus,
  sendPayout,
  sendBankPayout,
  checkPayoutStatus,
  calculatePayoutFee,
  getBalance,
} from './snippe'
