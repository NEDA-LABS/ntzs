/**
 * PSP adapter registry — the canonical adapter surface each provider exposes,
 * assembled from the provider modules. Business code dispatches through
 * ADAPTERS (by routed capability at creation time, or by the provider tag
 * stamped on a record at execution/reconciliation time). Never call a
 * provider module directly from business logic — only webhook handlers may
 * (for payload shapes + signature verification).
 */
import * as snippe from './snippe'
import * as azampay from './azampay'
// AzamPay runs DISBURSEMENT as a separate app (own host, credentials and a
// mandatory RSA checksum). The payout surface in ./azampay targets the
// collection/checkout host with a guessed payload and no checksum, so it can
// never succeed — payouts route here instead. Verified against the AzamPay
// sandbox 2026-07-15 (token, namelookup, disburse, duplicate detection).
import * as azampayDisb from './azampay-disbursement'
import * as selcom from './selcom'
import type {
  PspId,
  ProviderTag,
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

export interface PspAdapter {
  id: PspId
  /** Human-readable label for UI and logs. */
  label: string
  paymentWebhookPath: string
  payoutWebhookPath: string
  /** True when this provider's credentials are present in the environment. */
  isConfigured(): boolean
  initiatePayment(req: PaymentRequest): Promise<PaymentResponse & { provider?: string }>
  initiateCardPayment(req: CardPaymentRequest): Promise<CardPaymentResponse>
  /** `channel` = provider-specific network hint (e.g. AzamPay MNO enum, stored as pspChannel). */
  checkPaymentStatus(reference: string, channel?: string): Promise<PaymentStatusResponse>
  sendPayout(req: PayoutRequest): Promise<PayoutResponse>
  sendBankPayout(req: BankPayoutRequest): Promise<PayoutResponse>
  checkPayoutStatus(reference: string): Promise<PayoutStatusResponse>
  calculatePayoutFee(amount: number): Promise<PayoutFeeResponse>
  getBalance(): Promise<BalanceResponse>
  lookupAccountName(phone: string): Promise<{ name: string | null; phone: string }>
  lookupRecipientName(phone: string): Promise<{ name: string | null; idNumber?: string }>
}

export const PSP_IDS = ['snippe', 'azampay', 'selcom'] as const

export const ADAPTERS: Record<PspId, PspAdapter> = {
  snippe: {
    id: 'snippe',
    label: 'Snippe',
    paymentWebhookPath: '/api/webhooks/snippe/payment',
    payoutWebhookPath: '/api/webhooks/snippe/payout',
    isConfigured: () => Boolean(process.env.SNIPPE_API_KEY),
    initiatePayment: (req) => snippe.initiatePayment(req),
    initiateCardPayment: (req) => snippe.initiateCardPayment(req),
    checkPaymentStatus: (reference) => snippe.checkPaymentStatus(reference),
    sendPayout: (req) => snippe.sendPayout(req),
    sendBankPayout: (req) => snippe.sendBankPayout(req),
    checkPayoutStatus: (reference) => snippe.checkPayoutStatus(reference),
    calculatePayoutFee: (amount) => snippe.calculatePayoutFee(amount),
    getBalance: () => snippe.getBalance(),
    lookupAccountName: async (phone) => ({ name: null, phone: snippe.normalizePhone(phone) }),
    lookupRecipientName: async () => ({ name: null }),
  },
  azampay: {
    id: 'azampay',
    label: 'AzamPay',
    paymentWebhookPath: '/api/webhooks/azampay/payment',
    payoutWebhookPath: '/api/webhooks/azampay/payout',
    isConfigured: () => Boolean(process.env.AZAMPAY_CLIENT_ID),
    initiatePayment: (req) => azampay.initiatePayment(req),
    initiateCardPayment: () => azampay.initiateCardPayment(),
    checkPaymentStatus: (reference, channel) => azampay.checkPaymentStatus(reference, channel),
    // Payout surface -> the verified disbursement adapter (separate AzamPay app).
    sendPayout: (req) => azampayDisb.sendPayout(req),
    sendBankPayout: (req) => azampayDisb.sendBankPayout(req),
    checkPayoutStatus: (reference) => azampay.checkPayoutStatus(reference),
    calculatePayoutFee: (amount) => azampay.calculatePayoutFee(amount),
    getBalance: () => azampay.getBalance(),
    lookupAccountName: (phone) => azampay.lookupAccountName(phone),
    lookupRecipientName: (phone) => azampayDisb.lookupRecipientName(phone),
  },
  selcom: {
    id: 'selcom',
    label: 'Selcom',
    paymentWebhookPath: '/api/webhooks/selcom/payment',
    payoutWebhookPath: '/api/webhooks/selcom/payout',
    isConfigured: () => Boolean(process.env.SELCOM_API_KEY && process.env.SELCOM_PRIVATE_KEY),
    // Mobile collections = push-USSD (live on the NEDA sandbox, 13 Jul 2026).
    // Cards are NOT on the Business API — that stub still throws.
    initiatePayment: (req) => selcom.initiatePayment(req),
    initiateCardPayment: () => selcom.initiateCardPayment(),
    checkPaymentStatus: (reference) => selcom.checkPaymentStatus(reference),
    sendPayout: (req) => selcom.sendPayout(req),
    sendBankPayout: (req) => selcom.sendBankPayout(req),
    checkPayoutStatus: (reference) => selcom.checkPayoutStatus(reference),
    calculatePayoutFee: (amount) => selcom.calculatePayoutFee(amount),
    getBalance: () => selcom.getBalance(),
    lookupAccountName: (phone) => selcom.lookupAccountName(phone),
    lookupRecipientName: (phone) => selcom.lookupRecipientName(phone),
  },
}

/**
 * Resolve the adapter for a provider tag stamped on a DB record, mapping
 * legacy tags to their live adapter ('snippe_card' → snippe) and returning
 * the Snippe adapter for NULL/undefined stamps (Snippe was the only
 * historical rail). Returns null for tags with no live adapter (zenopay,
 * bank_transfer) — callers must handle those records via their legacy paths.
 */
export function adapterForTag(tag: ProviderTag | string | null | undefined): PspAdapter | null {
  switch (tag ?? 'snippe') {
    case 'snippe':
    case 'snippe_card':
      return ADAPTERS.snippe
    case 'azampay':
      return ADAPTERS.azampay
    case 'selcom':
      return ADAPTERS.selcom
    default:
      return null
  }
}
