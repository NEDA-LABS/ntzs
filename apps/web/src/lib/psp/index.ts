/**
 * PSP entry point — all business logic imports PSP functions from here,
 * never directly from a provider module. (Webhook handlers are the one
 * exception: they import '@/lib/psp/<provider>' for payload shapes and
 * signature verification, which are provider-specific by design.)
 *
 * This is now a routing facade over the shared @ntzs/psp package:
 *   - Which provider handles a flow is resolved from the `psp_routing` DB
 *     table (capability → provider, optional rules for amount bands / pilot
 *     allowlists), flipped instantly via scripts/set-psp-routing.ts.
 *   - Missing table/row → legacy ACTIVE_MOBILE_PSP env semantics, so this
 *     deploys safely before the migration is applied.
 *   - Routing is consulted at transaction CREATION only. Stamping callers
 *     (withdraw/offramp) resolve a route once via getPayoutRoute(), stamp
 *     provider + fee on the record, and pass the provider explicitly to
 *     sendPayout — executors and reconcilers then dispatch by stamp.
 */

import { getDb } from '@/lib/db'
import {
  ADAPTERS,
  adapterForTag,
  envDefaultProvider,
  getPayoutFeeTzs,
  resolveProvider,
  snippe,
  type PspCapability,
  type PspId,
  type ProviderTag,
  type RoutingContext,
  type RoutingRow,
} from '@ntzs/psp'

// ─── Canonical types (re-exported for the ~27 call sites) ────────────────────

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
  PspId,
  ProviderTag,
  PspCapability,
} from '@ntzs/psp'

export { ADAPTERS, adapterForTag, getPayoutFeeTzs, getReserveBalances } from '@ntzs/psp'
export type { ReservePot, PspAdapter } from '@ntzs/psp'

// ─── Phone utilities (identical implementation in all PSPs) ──────────────────

export const normalizePhone = snippe.normalizePhone
export const isValidTanzanianPhone = snippe.isValidTanzanianPhone

// ─── Routing (psp_routing table, TTL-cached, env fallback) ───────────────────

const ROUTING_TTL_MS = 30_000

let routingCache: { rows: Map<string, RoutingRow>; fetchedAt: number } | null = null

async function getRoutingRow(capability: PspCapability): Promise<RoutingRow | null> {
  const now = Date.now()
  if (!routingCache || now - routingCache.fetchedAt > ROUTING_TTL_MS) {
    try {
      const { sql } = getDb()
      const rows = await sql<{ capability: string; provider: string; rules: unknown }[]>`
        select capability, provider, rules from psp_routing
      `
      routingCache = {
        rows: new Map(rows.map((r) => [r.capability, { provider: r.provider, rules: r.rules }])),
        fetchedAt: now,
      }
    } catch (err) {
      // Pre-migration (table missing) or transient DB failure → env fallback.
      // Cache the empty result for one TTL so we don't hammer a broken DB.
      console.error('[psp] routing load failed — using env fallback:', err instanceof Error ? err.message : err)
      routingCache = { rows: new Map(), fetchedAt: now }
    }
  }
  return routingCache.rows.get(capability) ?? null
}

/** Resolve which provider currently handles a capability (creation-time only). */
export async function getActiveProviderId(capability: PspCapability, ctx?: RoutingContext): Promise<PspId> {
  return resolveProvider(capability, await getRoutingRow(capability), ctx)
}

/** Webhook path for a provider tag (legacy tags map to their live adapter). */
export function getWebhookPath(provider: ProviderTag | string | null | undefined, kind: 'payment' | 'payout'): string {
  const adapter = adapterForTag(provider) ?? ADAPTERS.snippe
  return kind === 'payment' ? adapter.paymentWebhookPath : adapter.payoutWebhookPath
}

/**
 * Resolve a payout route ONCE for a new withdrawal: provider + the fee to
 * bake into the gross-up + the webhook path. Callers stamp `provider` and
 * `pspFeeTzs` on the burn record and pass `provider` to sendPayout so the
 * executed route always matches the stamp.
 */
export async function getPayoutRoute(
  kind: 'mobile' | 'bank',
  opts: { receiveAmountTzs: number; userId?: string },
): Promise<{ provider: PspId; label: string; pspFeeTzs: number; payoutWebhookPath: string }> {
  const capability: PspCapability = kind === 'mobile' ? 'payouts_mobile' : 'payouts_bank'
  const provider = await getActiveProviderId(capability, { amountTzs: opts.receiveAmountTzs, userId: opts.userId })
  return {
    provider,
    label: ADAPTERS[provider].label,
    pspFeeTzs: getPayoutFeeTzs(provider, opts.receiveAmountTzs),
    payoutWebhookPath: ADAPTERS[provider].payoutWebhookPath,
  }
}

/**
 * Resolve a collection route for a new deposit: provider + webhook path +
 * the tag to write on deposit_requests.payment_provider (cards on Snippe
 * keep the historical 'snippe_card' tag).
 */
export async function getCollectionRoute(
  kind: 'mobile' | 'card',
  opts: { userId?: string } = {},
): Promise<{ provider: PspId; label: string; depositTag: ProviderTag; paymentWebhookPath: string }> {
  const capability: PspCapability = kind === 'mobile' ? 'collections_mobile' : 'collections_card'
  const provider = await getActiveProviderId(capability, { userId: opts.userId })
  return {
    provider,
    label: ADAPTERS[provider].label,
    depositTag: kind === 'card' && provider === 'snippe' ? 'snippe_card' : provider,
    paymentWebhookPath: ADAPTERS[provider].paymentWebhookPath,
  }
}

// ─── Legacy active-PSP identity (env-derived; prefer the getters above) ──────

function envActive(): PspId {
  return envDefaultProvider('payouts_mobile')
}

/** @deprecated Prefer getActiveProviderId()/getPayoutRoute() — routing is per-capability now. */
export const ACTIVE_PSP_NAME =
  process.env.ACTIVE_PSP_NAME || (process.env.ACTIVE_MOBILE_PSP === 'azampay' ? 'AzamPay' : 'Snippe')

/** @deprecated Prefer getCollectionRoute().depositTag. */
export const ACTIVE_PSP_PROVIDER: 'azampay' | 'snippe' =
  process.env.ACTIVE_MOBILE_PSP === 'azampay' ? 'azampay' : 'snippe'

/** Human-readable payment method label for UI. */
export const ACTIVE_PSP_METHOD_LABEL = 'Mobile Money'

/** @deprecated Prefer getCollectionRoute().paymentWebhookPath. */
export const ACTIVE_PSP_PAYMENT_WEBHOOK_PATH =
  process.env.ACTIVE_MOBILE_PSP === 'azampay' ? '/api/webhooks/azampay/payment' : '/api/webhooks/snippe/payment'

/** @deprecated Prefer getPayoutRoute().payoutWebhookPath. */
export const ACTIVE_PSP_PAYOUT_WEBHOOK_PATH =
  process.env.ACTIVE_MOBILE_PSP === 'azampay' ? '/api/webhooks/azampay/payout' : '/api/webhooks/snippe/payout'

/**
 * True when the active mobile PSP has its credentials configured.
 * Used as a guard in routes that conditionally trigger payouts.
 */
export function isMobilePspConfigured(): boolean {
  return ADAPTERS[envActive()].isConfigured()
}

// ─── Collections ──────────────────────────────────────────────────────────────

export async function initiatePayment(
  request: Parameters<PspAdapterInitiatePayment>[0],
  ctx?: { userId?: string },
): ReturnType<PspAdapterInitiatePayment> {
  const provider = await getActiveProviderId('collections_mobile', ctx)
  return ADAPTERS[provider].initiatePayment(request)
}
type PspAdapterInitiatePayment = (typeof ADAPTERS)['snippe']['initiatePayment']

export async function initiateCardPayment(
  request: Parameters<(typeof ADAPTERS)['snippe']['initiateCardPayment']>[0],
): ReturnType<(typeof ADAPTERS)['snippe']['initiateCardPayment']> {
  const provider = await getActiveProviderId('collections_card')
  return ADAPTERS[provider].initiateCardPayment(request)
}

/**
 * Check a collection's status. `channel` is the provider-specific network
 * hint stored as deposit_requests.pspChannel (AzamPay needs it). Pass the
 * record's stamped `providerTag` to dispatch to the right PSP; omitted →
 * legacy env-active behavior.
 */
export async function checkPaymentStatus(
  reference: string,
  channel?: string,
  providerTag?: ProviderTag | string | null,
): ReturnType<(typeof ADAPTERS)['snippe']['checkPaymentStatus']> {
  const adapter = providerTag !== undefined ? adapterForTag(providerTag) : ADAPTERS[envActive()]
  if (!adapter) throw new Error(`[psp] no live adapter for provider tag '${providerTag}'`)
  return adapter.checkPaymentStatus(reference, channel)
}

// ─── Payouts ──────────────────────────────────────────────────────────────────

/**
 * Send a mobile-money payout. Stamping callers resolve getPayoutRoute() first
 * and pass `provider` so the dispatch matches the stamped record; legacy
 * callers omit it and get the routed provider (Snippe today).
 */
export async function sendPayout(
  request: Parameters<(typeof ADAPTERS)['snippe']['sendPayout']>[0],
  provider?: PspId,
): ReturnType<(typeof ADAPTERS)['snippe']['sendPayout']> {
  const id = provider ?? (await getActiveProviderId('payouts_mobile', { amountTzs: request.amountTzs }))
  return ADAPTERS[id].sendPayout(request)
}

export async function sendBankPayout(
  request: Parameters<(typeof ADAPTERS)['snippe']['sendBankPayout']>[0],
  provider?: PspId,
): ReturnType<(typeof ADAPTERS)['snippe']['sendBankPayout']> {
  const id = provider ?? (await getActiveProviderId('payouts_bank', { amountTzs: request.amountTzs }))
  return ADAPTERS[id].sendBankPayout(request)
}

/**
 * Check a payout's status. Pass the record's stamped provider tag
 * (burn_requests.payout_provider; NULL = legacy Snippe) so reconciliation
 * queries the PSP that actually paid — never the currently-routed one.
 */
export async function checkPayoutStatus(
  reference: string,
  providerTag?: ProviderTag | string | null,
): ReturnType<(typeof ADAPTERS)['snippe']['checkPayoutStatus']> {
  const adapter = providerTag !== undefined ? adapterForTag(providerTag) : ADAPTERS[envActive()]
  if (!adapter) throw new Error(`[psp] no live adapter for provider tag '${providerTag}'`)
  return adapter.checkPayoutStatus(reference)
}

export async function calculatePayoutFee(
  amount: number,
): ReturnType<(typeof ADAPTERS)['snippe']['calculatePayoutFee']> {
  const provider = await getActiveProviderId('payouts_mobile', { amountTzs: amount })
  return ADAPTERS[provider].calculatePayoutFee(amount)
}

/**
 * @deprecated Single-pot balance of the env-active PSP, kept for legacy
 * callers. Reserve accounting must use getReserveBalances() — the reserve is
 * the SUM of all pots.
 */
export async function getBalance(): ReturnType<(typeof ADAPTERS)['snippe']['getBalance']> {
  return ADAPTERS[envActive()].getBalance()
}

// ─── Name lookups ─────────────────────────────────────────────────────────────

export async function lookupAccountName(phone: string): Promise<{ name: string | null; phone: string }> {
  const provider = await getActiveProviderId('collections_mobile')
  return ADAPTERS[provider].lookupAccountName(phone)
}

export async function lookupRecipientName(phone: string): Promise<{ name: string | null; idNumber?: string }> {
  const provider = await getActiveProviderId('payouts_mobile')
  return ADAPTERS[provider].lookupRecipientName(phone)
}
