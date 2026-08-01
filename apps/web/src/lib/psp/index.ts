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
import * as selcom from './selcom'
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

// ─── Name lookup — provider chain, independent of who moves the money ────────
//
// Selcom first: its account-lookup covers ALL five wallets (including Vodacom
// M-Pesa, which AzamPay cannot serve) plus bank accounts, and needs no IP
// whitelisting on our credential. AzamPay is the fallback (its namelookup
// rides their IP-whitelisted disbursement surface, so it only answers once
// static egress exists). Every step is fail-soft — a null name never blocks.

function selcomLookupConfigured(): boolean {
  return Boolean(
    process.env.SELCOM_API_KEY && process.env.SELCOM_PRIVATE_KEY && process.env.SELCOM_ACCOUNT_NUMBER
  )
}

/**
 * Telco SIM-registration evidence is PSP-independent (Tier B of the KYC
 * ladder): attempt the AzamPay lookup whenever its credentials are configured,
 * even while Snippe moves the money. azampay.lookupRecipientName never throws.
 */
function azamPayLookupConfigured(): boolean {
  return Boolean(
    process.env.AZAMPAY_APP_NAME && process.env.AZAMPAY_CLIENT_ID && process.env.AZAMPAY_CLIENT_SECRET
  )
}

// ─── Lookup volume guard (cache + restriction breaker) ───────────────────────
//
// Every quote, partner lookup call and deposit form hits this chain, and on
// 24 Jul Selcom temporarily restricted our credential for "excessive lookup
// usage". Two defenses, both per warm lambda instance (which is exactly where
// high-volume traffic lives):
//   1. Result cache — a number's registered name doesn't change day to day;
//      hits are held 24h, misses 10min (transient failures must not stick).
//   2. Circuit breaker — when Selcom answers with a rate-limit/restriction
//      signal, stop sending it lookups for 15 minutes instead of hammering a
//      closed door (which risks extending the restriction).

const NAME_HIT_TTL_MS = 24 * 3600_000
const NAME_MISS_TTL_MS = 10 * 60_000
const RESTRICTION_BACKOFF_MS = 15 * 60_000
const NAME_CACHE_MAX = 5000
const nameCache = new Map<string, { name: string | null; idNumber?: string; exp: number }>()
let selcomLookupPausedUntil = 0

export function _resetLookupGuardForTests(): void {
  nameCache.clear()
  selcomLookupPausedUntil = 0
}

export async function lookupRecipientName(
  phone: string
): Promise<{ name: string | null; idNumber?: string }> {
  let key: string | null = null
  try {
    key = snippe.normalizePhone(phone)
  } catch {
    key = null
  }
  const now = Date.now()

  if (key) {
    const cached = nameCache.get(key)
    if (cached && cached.exp > now) {
      return { name: cached.name, idNumber: cached.idNumber }
    }
  }

  const result = await lookupRecipientNameUncached(phone, now)

  if (key) {
    if (nameCache.size >= NAME_CACHE_MAX) {
      const oldest = nameCache.keys().next().value
      if (oldest !== undefined) nameCache.delete(oldest)
    }
    nameCache.set(key, {
      name: result.name,
      idNumber: result.idNumber,
      exp: now + (result.name ? NAME_HIT_TTL_MS : NAME_MISS_TTL_MS),
    })
  }
  return result
}

async function lookupRecipientNameUncached(
  phone: string,
  now: number
): Promise<{ name: string | null; idNumber?: string }> {
  if (selcomLookupConfigured() && now >= selcomLookupPausedUntil) {
    try {
      const r = await selcom.lookupRecipientName(phone)
      if (r.name) return { name: r.name }
      if (r.reason && /http:(403|429)|restricted|excessive|rate.?limit/i.test(r.reason)) {
        selcomLookupPausedUntil = now + RESTRICTION_BACKOFF_MS
        console.warn(
          `[psp] selcom lookup restricted — pausing selcom lookups for ${RESTRICTION_BACKOFF_MS / 60_000} min: ${r.reason}`
        )
      }
    } catch {
      // fall through to the next provider
    }
  }
  if (useAzamPay() || azamPayLookupConfigured()) {
    try {
      return await azampay.lookupRecipientName(phone)
    } catch {
      // fall through
    }
  }
  return { name: null }
}

export async function lookupAccountName(
  phone: string
): Promise<{ name: string | null; phone: string }> {
  const normalized = snippe.normalizePhone(phone)
  const { name } = await lookupRecipientName(phone)
  return { name, phone: normalized }
}

// ─── Card payments — always Snippe ───────────────────────────────────────────

export const initiateCardPayment = snippe.initiateCardPayment

// ─── Multi-rail routing (collections + disbursements) ────────────────────────
//
// Per-network, priority-ordered rail plans with initiation failover, so one
// PSP being down never strands a user. Plans come from lib/psp/routing.ts
// (pure, tested); with no routing env vars set every plan is exactly
// [ACTIVE_MOBILE_PSP] — the legacy single-rail behaviour.

import {
  detectNetwork,
  planCollectionRails,
  planDisbursementRails,
  readRailEnv,
  type RailId,
} from './routing'
import { getPayoutFeeTzs } from './selcom-fees'

export { detectNetwork } from './routing'

/** Rails with a live adapter. Selcom is capability-gated in routing.ts. */
export type LiveRail = 'snippe' | 'azampay' | 'selcom'
const RAIL_IMPL = { snippe, azampay, selcom } as const

export const PAYMENT_WEBHOOK_PATHS: Record<LiveRail, string> = {
  snippe: '/api/webhooks/snippe/payment',
  azampay: '/api/webhooks/azampay/payment',
  selcom: '/api/webhooks/selcom/payment',
}
export const PAYOUT_WEBHOOK_PATHS: Record<LiveRail, string> = {
  snippe: '/api/webhooks/snippe/payout',
  azampay: '/api/webhooks/azampay/payout',
  selcom: '/api/webhooks/selcom/payout',
}

const liveRails = (plan: RailId[]): LiveRail[] =>
  plan.filter((r): r is LiveRail => r === 'snippe' || r === 'azampay' || r === 'selcom')

/**
 * The rail a disbursement will be tried on FIRST right now — the head of the
 * same env-gated plan sendPayoutRouted walks. Null when no rail is configured.
 * Quotes must price against THIS: on 1 Aug 2026 the app quoted Snippe's flat
 * 1,500 while Selcom (tier fee 150 at 5,000 TZS) actually served the payout.
 */
export function expectedDisbursementRail(env: NodeJS.ProcessEnv = process.env): LiveRail | null {
  return liveRails(planDisbursementRails(readRailEnv(env)))[0] ?? null
}

/**
 * PSP fee (TZS) for a payout where the recipient receives `receiveTzs`,
 * priced on the expected serving rail (legacy Snippe flat fee when none
 * resolves). If the primary rail is down and the payout fails over, the
 * actual PSP charge can differ from what was quoted — the platform absorbs
 * that difference: failover is the exception, and re-charging the user after
 * the fact is not an option.
 */
export function expectedPayoutFeeTzs(receiveTzs: number, env: NodeJS.ProcessEnv = process.env): number {
  return getPayoutFeeTzs(expectedDisbursementRail(env), receiveTzs)
}

import type { PaymentRequest as PaymentRequestT, PaymentResponse as PaymentResponseT, PayoutRequest as PayoutRequestT, PayoutResponse as PayoutResponseT } from './types'

export interface RoutedCollectionResult {
  payment: PaymentResponseT
  /** The rail that actually served (or last attempted) — callers MUST persist
   * this on the deposit row: webhooks and pollers are provider-scoped. */
  provider: LiveRail
  attempted: LiveRail[]
}

/**
 * Initiate a mobile-money collection with rail failover. Each attempt sends
 * the serving rail's OWN payment-webhook URL, so confirmation always lands on
 * the right handler regardless of which rail won.
 */
export async function initiateCollection(
  req: Omit<PaymentRequestT, 'webhookUrl'> & { webhookBaseUrl: string }
): Promise<RoutedCollectionResult> {
  const { webhookBaseUrl, ...payment } = req
  const plan = liveRails(planCollectionRails(detectNetwork(req.phoneNumber), readRailEnv()))
  const attempted: LiveRail[] = []
  let last: PaymentResponseT = { success: false, error: 'No collection rail is configured for this network' }

  for (const rail of plan) {
    attempted.push(rail)
    try {
      const result = await RAIL_IMPL[rail].initiatePayment({
        ...payment,
        webhookUrl: `${webhookBaseUrl}${PAYMENT_WEBHOOK_PATHS[rail]}`,
      })
      if (result.success) {
        if (attempted.length > 1) {
          console.warn(`[psp] collection failed over: ${attempted.join(' → ')}`)
        }
        return { payment: result, provider: rail, attempted }
      }
      last = result
      console.warn(`[psp] collection initiation failed on ${rail}: ${result.error}`)
    } catch (err) {
      last = { success: false, error: err instanceof Error ? err.message : 'rail error' }
      console.warn(`[psp] collection initiation threw on ${rail}: ${last.error}`)
    }
  }

  return { payment: last, provider: attempted[attempted.length - 1] ?? ACTIVE_PSP_PROVIDER, attempted }
}

export interface RoutedPayoutResult {
  payout: PayoutResponseT
  provider: LiveRail
  attempted: LiveRail[]
}

/** Disburse with rail failover (same contract as initiateCollection). */
export async function sendPayoutRouted(
  req: Omit<PayoutRequestT, 'webhookUrl'> & { webhookBaseUrl: string }
): Promise<RoutedPayoutResult> {
  const { webhookBaseUrl, ...payout } = req
  const plan = liveRails(planDisbursementRails(readRailEnv()))
  const attempted: LiveRail[] = []
  let last: PayoutResponseT = { success: false, error: 'No disbursement rail is configured' }

  for (const rail of plan) {
    attempted.push(rail)
    try {
      const result = await RAIL_IMPL[rail].sendPayout({
        ...payout,
        webhookUrl: `${webhookBaseUrl}${PAYOUT_WEBHOOK_PATHS[rail]}`,
      })
      if (result.success) {
        if (attempted.length > 1) {
          console.warn(`[psp] payout failed over: ${attempted.join(' → ')}`)
        }
        return { payout: result, provider: rail, attempted }
      }
      last = result
      console.warn(`[psp] payout failed on ${rail}: ${result.error}`)
    } catch (err) {
      last = { success: false, error: err instanceof Error ? err.message : 'rail error' }
      console.warn(`[psp] payout threw on ${rail}: ${last.error}`)
    }
  }

  return { payout: last, provider: attempted[attempted.length - 1] ?? ACTIVE_PSP_PROVIDER, attempted }
}

/**
 * Status query on the SPECIFIC rail that dispatched a payout — the routed
 * counterpart of checkPayoutStatus, which only ever asks the single
 * ACTIVE_MOBILE_PSP. A payout that failed over to another rail must be
 * polled where it actually went, or the poll answers for the wrong system.
 */
export async function checkPayoutStatusFor(
  rail: LiveRail,
  reference: string,
): ReturnType<typeof snippe.checkPayoutStatus> {
  return RAIL_IMPL[rail].checkPayoutStatus(reference)
}

/** True when at least one disbursement-capable rail is configured — the gate
 * for attempting a routed payout at all. isMobilePspConfigured() only answers
 * for the single active PSP, which under-reports once rails can fail over. */
export function anyDisbursementRailConfigured(): boolean {
  return liveRails(planDisbursementRails(readRailEnv())).length > 0
}

// ─── Rail health (burn gate + monitoring cron) ───────────────────────────────

export interface RailHealth {
  rail: LiveRail
  healthy: boolean
  error?: string
}

/**
 * Probe one rail with a cheap authenticated call, bounded to 8s.
 *
 * Probe what the rail is actually asked to do: while AzamPay disbursements
 * are gated off (IP whitelisting pending), it serves collections only — so
 * probe token auth, not the balance API, which lives on the IP-whitelisted
 * disbursement surface and would read DOWN forever from Vercel egress. Once
 * AZAMPAY_DISBURSEMENT_ENABLED flips, the balance read becomes the probe
 * again (full disbursement health, which the burn gate relies on).
 */
export async function probeRail(rail: LiveRail): Promise<RailHealth> {
  const collectionsOnlyAzam =
    rail === 'azampay' && process.env.AZAMPAY_DISBURSEMENT_ENABLED !== 'true'
  try {
    await Promise.race([
      collectionsOnlyAzam ? azampay.probeAuth() : RAIL_IMPL[rail].getBalance(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout (8s)')), 8_000)),
    ])
    return { rail, healthy: true }
  } catch (err) {
    return { rail, healthy: false, error: err instanceof Error ? err.message : 'probe failed' }
  }
}

/** Every rail that any current plan could use — what the health cron watches. */
export function railsToMonitor(): LiveRail[] {
  const env = readRailEnv()
  const rails = new Set<LiveRail>()
  for (const network of ['vodacom', 'airtel', 'tigo', 'halotel', 'ttcl', 'unknown'] as const) {
    for (const r of liveRails(planCollectionRails(network, env))) rails.add(r)
  }
  for (const r of liveRails(planDisbursementRails(env))) rails.add(r)
  return [...rails]
}

/**
 * First disbursement rail that answers a live probe, or null when none do.
 * The burn engine uses this as its gate: burning is irreversible, so it must
 * not run ahead of a cash leg that cannot complete.
 */
export async function firstHealthyDisbursementRail(): Promise<LiveRail | null> {
  for (const rail of liveRails(planDisbursementRails(readRailEnv()))) {
    const probe = await probeRail(rail)
    if (probe.healthy) return rail
    console.warn(`[psp] disbursement rail ${rail} unhealthy: ${probe.error}`)
  }
  return null
}
