/**
 * PSP entry point — all business logic imports PSP functions from here,
 * never directly from a provider module.
 *
 * Mobile money routing is controlled by ACTIVE_MOBILE_PSP:
 *   ACTIVE_MOBILE_PSP=snippe   → Snippe handles mobile on-ramp + off-ramp (default / production safe)
 *   ACTIVE_MOBILE_PSP=azampay  → AzamPay handles mobile on-ramp + off-ramp
 *
 * Card payments always route through Snippe regardless of this flag.
 * Legacy PSP: ZenoPay (deprecated — historical records only, webhook handler kept alive).
 *
 * To go live with AzamPay: set ACTIVE_MOBILE_PSP=azampay in the environment.
 * No code deploy required.
 */

import * as azampay from './azampay'
import * as snippe from './snippe'

// ─── PSP selection ────────────────────────────────────────────────────────────

function useAzamPay(): boolean {
  return process.env.ACTIVE_MOBILE_PSP === 'azampay'
}

// ─── Active PSP identity ──────────────────────────────────────────────────────

/** Human-readable label shown in UI and logs. */
export const ACTIVE_PSP_NAME =
  process.env.ACTIVE_PSP_NAME || (process.env.ACTIVE_MOBILE_PSP === 'azampay' ? 'AzamPay' : 'Snippe')

/** DB value written to psp_provider for new mobile money deposits. */
export const ACTIVE_PSP_PROVIDER: 'azampay' | 'snippe' =
  process.env.ACTIVE_MOBILE_PSP === 'azampay' ? 'azampay' : 'snippe'

/** Human-readable payment method label for UI. */
export const ACTIVE_PSP_METHOD_LABEL = 'Mobile Money'

/**
 * Webhook path for payment (collection) callbacks.
 * Used in the deposit action so the correct handler receives events.
 */
export const ACTIVE_PSP_PAYMENT_WEBHOOK_PATH =
  process.env.ACTIVE_MOBILE_PSP === 'azampay'
    ? '/api/webhooks/azampay/payment'
    : '/api/webhooks/snippe/payment'

/**
 * Webhook path for payout (disbursement) callbacks.
 * Used in the withdrawal route so the correct handler receives events.
 */
export const ACTIVE_PSP_PAYOUT_WEBHOOK_PATH =
  process.env.ACTIVE_MOBILE_PSP === 'azampay'
    ? '/api/webhooks/azampay/payout'
    : '/api/webhooks/snippe/payout'

/**
 * True when the active mobile PSP has its credentials configured.
 * Used as a guard in routes that conditionally trigger payouts.
 */
export function isMobilePspConfigured(): boolean {
  return useAzamPay()
    ? Boolean(process.env.AZAMPAY_CLIENT_ID)
    : Boolean(process.env.SNIPPE_API_KEY)
}

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

// ─── Phone utilities (identical implementation in both PSPs) ─────────────────

export const normalizePhone = snippe.normalizePhone
export const isValidTanzanianPhone = snippe.isValidTanzanianPhone

// ─── Mobile money — routed by ACTIVE_MOBILE_PSP ──────────────────────────────

export async function initiatePayment(
  ...args: Parameters<typeof snippe.initiatePayment>
): ReturnType<typeof snippe.initiatePayment> {
  return useAzamPay() ? azampay.initiatePayment(...args) : snippe.initiatePayment(...args)
}

export async function checkPaymentStatus(
  reference: string,
  provider?: string
): ReturnType<typeof snippe.checkPaymentStatus> {
  return useAzamPay()
    ? azampay.checkPaymentStatus(reference, provider)
    : snippe.checkPaymentStatus(reference)
}

export async function sendPayout(
  ...args: Parameters<typeof snippe.sendPayout>
): ReturnType<typeof snippe.sendPayout> {
  return useAzamPay() ? azampay.sendPayout(...args) : snippe.sendPayout(...args)
}

export async function sendBankPayout(
  ...args: Parameters<typeof snippe.sendBankPayout>
): ReturnType<typeof snippe.sendBankPayout> {
  return useAzamPay() ? azampay.sendBankPayout(...args) : snippe.sendBankPayout(...args)
}

export async function checkPayoutStatus(
  ...args: Parameters<typeof snippe.checkPayoutStatus>
): ReturnType<typeof snippe.checkPayoutStatus> {
  return useAzamPay() ? azampay.checkPayoutStatus(...args) : snippe.checkPayoutStatus(...args)
}

export async function calculatePayoutFee(
  ...args: Parameters<typeof snippe.calculatePayoutFee>
): ReturnType<typeof snippe.calculatePayoutFee> {
  return useAzamPay() ? azampay.calculatePayoutFee(...args) : snippe.calculatePayoutFee(...args)
}

export async function getBalance(): ReturnType<typeof snippe.getBalance> {
  return useAzamPay() ? azampay.getBalance() : snippe.getBalance()
}

// ─── Name lookup — AzamPay only; graceful no-op for Snippe ──────────────────

export async function lookupAccountName(
  phone: string
): Promise<{ name: string | null; phone: string }> {
  return useAzamPay()
    ? azampay.lookupAccountName(phone)
    : { name: null, phone: snippe.normalizePhone(phone) }
}

export async function lookupRecipientName(
  phone: string
): Promise<{ name: string | null; idNumber?: string }> {
  return useAzamPay() ? azampay.lookupRecipientName(phone) : { name: null }
}

// ─── Card payments — always Snippe ───────────────────────────────────────────

export const initiateCardPayment = snippe.initiateCardPayment
