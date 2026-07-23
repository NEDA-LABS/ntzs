import crypto from 'crypto'

/**
 * Withdrawal quotes — the enforcement layer that guarantees every payout
 * client (NEDApay included) has the recipient name, the fee breakdown, and
 * the net amount IN HAND before a burn can execute.
 *
 * Flow: POST /api/v1/withdrawals/quote → { quoteId, recipientName, fees… }
 *       POST /api/v1/withdrawals { …, quoteId } → executes
 *
 * Quotes are STATELESS: quoteId is an HMAC-signed token over the economic
 * terms (partner, user, phone, receive amount, burn amount, platform fee,
 * expiry). No table, no migration; the signature stops tampering and the
 * execute route re-derives the gross-up so a stale fee config can't slip
 * through. Enforcement is env-gated (WAAS_REQUIRE_QUOTE) so existing
 * integrations keep working until partners adopt the quote step.
 */

/** Snippe flat payout fee (TZS). ⚠ Single source of truth for the WaaS
 * withdrawal gross-up — keep in sync with the payout engine. */
export const PSP_FLAT_FEE_TZS = 1500
export const DEFAULT_PLATFORM_FEE_PERCENT = 0.5
export const QUOTE_TTL_MS = 5 * 60 * 1000

export interface WithdrawalGrossUp {
  /** nTZS burned from the user's wallet. */
  burnAmountTzs: number
  /** Our fee (minted to treasury), = burn − receive − PSP flat fee. */
  platformFeeTzs: number
  /** PSP flat fee (kept in reserve to fund the PSP's charge). */
  pspFeeTzs: number
}

/** burnAmount = ceil((receive + pspFee) / (1 − feePercent/100)) — identical
 * math in quote and execute, or a quote could mismatch its own execution. */
export function computeWithdrawalGrossUp(receiveAmountTzs: number, feePercent: number): WithdrawalGrossUp {
  const burnAmountTzs = Math.ceil((receiveAmountTzs + PSP_FLAT_FEE_TZS) / (1 - feePercent / 100))
  return {
    burnAmountTzs,
    platformFeeTzs: burnAmountTzs - receiveAmountTzs - PSP_FLAT_FEE_TZS,
    pspFeeTzs: PSP_FLAT_FEE_TZS,
  }
}

export interface QuotePayload {
  v: 1
  partnerId: string
  userId: string
  /** Normalized recipient phone the quote was issued for. */
  phone: string
  receiveAmountTzs: number
  burnAmountTzs: number
  platformFeeTzs: number
  /** Unix ms expiry. */
  exp: number
}

function quoteSecret(): string | null {
  return process.env.WAAS_QUOTE_SECRET || process.env.FX_JWT_SECRET || null
}

const b64url = (b: Buffer) => b.toString('base64url')

function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest())
}

/** Returns null when no signing secret is configured (quote feature off). */
export function createQuoteToken(payload: Omit<QuotePayload, 'v' | 'exp'>, now = Date.now()): string | null {
  const secret = quoteSecret()
  if (!secret) return null
  const full: QuotePayload = { v: 1, ...payload, exp: now + QUOTE_TTL_MS }
  const body = b64url(Buffer.from(JSON.stringify(full)))
  return `${body}.${sign(body, secret)}`
}

export type QuoteVerification =
  | { ok: true; payload: QuotePayload }
  | { ok: false; reason: 'unconfigured' | 'malformed' | 'bad_signature' | 'expired' }

export function verifyQuoteToken(token: string, now = Date.now()): QuoteVerification {
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
  let payload: QuotePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.v !== 1 || typeof payload.exp !== 'number') return { ok: false, reason: 'malformed' }
  if (now > payload.exp) return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}

/** Exactly 'true' → executing a withdrawal REQUIRES a valid matching quote. */
export function quoteRequired(): boolean {
  return process.env.WAAS_REQUIRE_QUOTE === 'true'
}
