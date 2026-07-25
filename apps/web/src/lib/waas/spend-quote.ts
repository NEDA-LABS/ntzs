import crypto from 'crypto'

import { estimateSendMoneyFee } from '@/lib/psp/selcom-fees'
import { DEFAULT_PLATFORM_FEE_PERCENT, QUOTE_TTL_MS } from '@/lib/waas/quote'

/**
 * Spend quotes — the disclosure contract for the "spend your nTZS" rails
 * (burn → Selcom lipa/bill payment). Unlike withdrawals (where quotes were
 * retrofitted behind WAAS_REQUIRE_QUOTE), spend is quote-first BY DESIGN:
 * POST /api/v1/spend refuses to execute without a valid quoteId, so every
 * client shows the merchant/biller name and the full fee breakdown before
 * money moves. Same stateless HMAC-token mechanics as withdrawal quotes.
 *
 * Fee model: burn = principal + selcomFee + platformFee.
 *  - principal      → what the till/biller receives
 *  - selcomFee      → Selcom's charge, funded from the reserve. Estimated
 *                     from the published send-money tariff — the first live
 *                     lipa payment's measured charge (TZS 30 on 1,000, ref
 *                     202607250630) matches that tariff exactly. Actuals are
 *                     recorded per transaction at settlement; drift is logged.
 *                     ⚠ Replace with Selcom's official spend tariff when it arrives.
 *  - platformFee    → our margin (partner feePercent, minted to treasury)
 */

export const SPEND_MIN_TZS = 500

export type SpendKind = 'lipa' | 'bill'

export interface SpendTotals {
  principalTzs: number
  selcomFeeTzs: number
  platformFeeTzs: number
  burnAmountTzs: number
}

/** Identical math in quote and execute, or a quote could mismatch its own
 * execution (the withdrawal-quote lesson). */
export function computeSpendTotals(principalTzs: number, feePercent: number): SpendTotals {
  const selcomFeeTzs = estimateSendMoneyFee(principalTzs)
  const platformFeeTzs = Math.ceil((principalTzs * feePercent) / 100)
  return {
    principalTzs,
    selcomFeeTzs,
    platformFeeTzs,
    burnAmountTzs: principalTzs + selcomFeeTzs + platformFeeTzs,
  }
}

/** Canonical target string — one comparable value per destination. */
export function spendTarget(kind: SpendKind, a: { payNumber?: string; utilityCode?: string; utilityRef?: string }): string {
  return kind === 'lipa' ? `lipa:${a.payNumber ?? ''}` : `bill:${a.utilityCode ?? ''}:${a.utilityRef ?? ''}`
}

export interface SpendQuotePayload {
  v: 1
  k: 'spend'
  kind: SpendKind
  partnerId: string
  userId: string
  /** spendTarget() of the destination the name+fees were disclosed for. */
  target: string
  network?: string
  principalTzs: number
  selcomFeeTzs: number
  platformFeeTzs: number
  burnAmountTzs: number
  /** Name shown to the user at quote time (null = lookup had no answer). */
  recipientName: string | null
  /** Unix ms expiry. */
  exp: number
}

// Same secret + HMAC construction as withdrawal quotes (lib/waas/quote.ts) —
// the `k:'spend'` discriminator keeps the token spaces mutually unusable.
function quoteSecret(): string | null {
  return process.env.WAAS_QUOTE_SECRET || process.env.FX_JWT_SECRET || null
}

const b64url = (b: Buffer) => b.toString('base64url')

function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest())
}

/** Returns null when no signing secret is configured (quote feature off). */
export function createSpendQuoteToken(
  payload: Omit<SpendQuotePayload, 'v' | 'k' | 'exp'>,
  now = Date.now()
): string | null {
  const secret = quoteSecret()
  if (!secret) return null
  const full: SpendQuotePayload = { v: 1, k: 'spend', ...payload, exp: now + QUOTE_TTL_MS }
  const body = b64url(Buffer.from(JSON.stringify(full)))
  return `${body}.${sign(body, secret)}`
}

export type SpendQuoteVerification =
  | { ok: true; payload: SpendQuotePayload }
  | { ok: false; reason: 'unconfigured' | 'malformed' | 'bad_signature' | 'expired' | 'wrong_kind' }

export function verifySpendQuoteToken(token: string, now = Date.now()): SpendQuoteVerification {
  const secret = quoteSecret()
  if (!secret) return { ok: false, reason: 'unconfigured' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed' }
  const [body, sig] = parts
  const expected = sign(body, secret)
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'bad_signature' }
  }
  let payload: SpendQuotePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.v !== 1 || typeof payload.exp !== 'number') return { ok: false, reason: 'malformed' }
  // A withdrawal-quote token must never execute a spend (and vice versa).
  if (payload.k !== 'spend') return { ok: false, reason: 'wrong_kind' }
  if (now > payload.exp) return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}

/** Master gate for the spend rails (routes + cron). Per-kind gates
 * (SELCOM_LIPA_ENABLED / SELCOM_BILLPAY_ENABLED) apply on top. */
export function spendEnabled(): boolean {
  return process.env.SELCOM_SPEND_ENABLED === 'true'
}

export function spendKindEnabled(kind: SpendKind): boolean {
  return kind === 'lipa'
    ? process.env.SELCOM_LIPA_ENABLED === 'true'
    : process.env.SELCOM_BILLPAY_ENABLED === 'true'
}

export { DEFAULT_PLATFORM_FEE_PERCENT }
