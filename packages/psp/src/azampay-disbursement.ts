/**
 * AzamPay DISBURSEMENT (off-ramp / payout) adapter.
 *
 * AzamPay runs disbursement as a SEPARATE application from collection: different
 * host, different auth host, different credentials, and a mandatory RSA checksum.
 * The previous implementation (in azampay.ts) targeted the *collection* checkout
 * host with a guessed payload and no checksum, so it could never succeed.
 *
 * Contract below is VERIFIED against the sandbox (2026-07-15):
 *   token     POST {AUTH}/AppRegistration/GenerateToken     -> { data.accessToken, data.expire }
 *   namelookup POST {DISB}/api/v1/azampay/namelookup         -> { status, name, fName, lName, ... }
 *   disburse  POST {DISB}/api/v1/azampay/disburse            -> { success, pgReferenceId, status }
 *
 * Checksum (per AzamPay, confirmed working):
 *   Base64( RSA_PKCS1( SHA512( sourceAcc + destAcc + currency + amount + epochDate + externalReferenceId ) ) )
 *   - SHA-512 RAW digest (not hex), RSA public-key encryption with PKCS#1 v1.5 padding.
 *   - The epochDate and externalReferenceId used here MUST equal those sent in the body.
 *
 * PENDING confirmation from AzamPay (do not guess on a money path):
 *   - transferDetails.type valid values (sandbox accepts MNO/BANK/SAME, rejects only empty) -> AZAMPAY_DISB_TYPE
 *   - our real source account number                                   -> AZAMPAY_DISB_SOURCE_ACCOUNT
 *   - exact bankName strings per MNO (only "Azampesa" resolves in sandbox)
 *   - whether externalReferenceId is de-duplicated (idempotency)
 *   - production host + whether namelookup requires a checksum
 *   - status-query and balance endpoints on the disbursement host
 */

import crypto from 'crypto'

// ─── Config ───────────────────────────────────────────────────────────────────

const isProd = () => (process.env.AZAMPAY_DISB_ENV ?? process.env.AZAMPAY_ENV) === 'production'

/** Base URLs are env-overridable: the production disbursement host is unconfirmed. */
function authBase(): string {
  return process.env.AZAMPAY_DISB_AUTH_BASE
    || (isProd() ? 'https://authenticator.azampay.co.tz' : 'https://authenticator-test.azampay.co.tz')
}
function disbBase(): string {
  return process.env.AZAMPAY_DISB_BASE
    || (isProd() ? 'https://api-disbursement.azampay.co.tz' : 'https://api-disbursement-test.azampay.co.tz')
}

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`${key} is not configured`)
  return v
}

/** PEM may arrive with escaped newlines from env config. */
const publicKeyPem = () => requireEnv('AZAMPAY_DISB_PUBLIC_KEY').replace(/\\n/g, '\n')
const sourceAccount = () => requireEnv('AZAMPAY_DISB_SOURCE_ACCOUNT')
const sourceBank = () => process.env.AZAMPAY_DISB_SOURCE_BANK || 'Azampesa'
const sourceName = () => process.env.AZAMPAY_DISB_SOURCE_NAME || 'NEDA LABS'
const transferType = () => process.env.AZAMPAY_DISB_TYPE || 'MNO'
/** Sandbox only provisions Azampesa; set this to pin every payout to one provider. */
const forcedBank = () => process.env.AZAMPAY_DISB_FORCE_BANK || ''

export const CURRENCY = 'TZS'

// ─── Phone / provider ─────────────────────────────────────────────────────────

export function normalizeDisbPhone(phone: string): string {
  let n = phone.replace(/[\s\-+]/g, '')
  if (n.startsWith('0')) n = '255' + n.slice(1)
  if (!n.startsWith('255')) n = '255' + n
  return n
}

/**
 * Map a Tanzanian MSISDN to the AzamPay `bankName`.
 *
 * Returns null for Vodacom (M-Pesa): AzamPay cannot disburse to Vodacom until
 * NEDA opens a Vodacom account. The previous implementation silently mapped
 * Vodacom prefixes to "azampesa", which would MISROUTE the payout.
 *
 * ⚠ Exact strings pending AzamPay confirmation — only "Azampesa" resolves in sandbox.
 */
export function azamPayBankFor(normalizedPhone: string): string | null {
  const forced = forcedBank()
  if (forced) return forced
  const p = normalizedPhone.slice(3, 5)
  if (['74', '75', '76'].includes(p)) return null // Vodacom M-Pesa — not enabled
  if (['68', '69', '78'].includes(p)) return 'Airtel'
  if (['65', '67', '71'].includes(p)) return 'Tigo'
  if (['61', '62'].includes(p)) return 'Halopesa'
  return 'Azampesa'
}

// ─── Auth (separate app + token cache from collection) ───────────────────────

let tokenCache: { accessToken: string; expiresAt: number } | null = null

export async function getDisbursementToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.accessToken

  const res = await fetch(`${authBase()}/AppRegistration/GenerateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appName: requireEnv('AZAMPAY_DISB_APP_NAME'),
      clientId: requireEnv('AZAMPAY_DISB_CLIENT_ID'),
      clientSecret: requireEnv('AZAMPAY_DISB_CLIENT_SECRET'),
    }),
    signal: AbortSignal.timeout(15_000),
  })

  const result = await res.json() as {
    success?: boolean
    message?: string
    data?: { accessToken?: string; expire?: string }
  }
  if (!result.success || !result.data?.accessToken) {
    throw new Error(`AzamPay disbursement auth failed: ${result.message ?? 'unknown error'}`)
  }
  const expiresAt = result.data.expire ? new Date(result.data.expire).getTime() : Date.now() + 55 * 60_000
  tokenCache = { accessToken: result.data.accessToken, expiresAt }
  return tokenCache.accessToken
}

// ─── Checksum ─────────────────────────────────────────────────────────────────

export interface ChecksumInput {
  sourceAcc: string
  destAcc: string
  currency: string
  /** String form, exactly as concatenated (e.g. "1000"). */
  amount: string
  epochDate: number
  externalReferenceId: string
}

/** Base64(RSA_PKCS1(SHA512(src+dst+currency+amount+epoch+extRef))) — verified. */
export function disbursementChecksum(i: ChecksumInput): string {
  const input = `${i.sourceAcc}${i.destAcc}${i.currency}${i.amount}${i.epochDate}${i.externalReferenceId}`
  const sha512 = crypto.createHash('sha512').update(input, 'utf8').digest()
  return crypto
    .publicEncrypt({ key: publicKeyPem(), padding: crypto.constants.RSA_PKCS1_PADDING }, sha512)
    .toString('base64')
}

/** AzamPay caps externalReferenceId at 30 chars. */
export function makeExternalReferenceId(seed?: string): string {
  const raw = (seed ?? crypto.randomUUID()).replace(/-/g, '')
  return raw.slice(0, 30)
}

// ─── Name lookup ──────────────────────────────────────────────────────────────

export interface DisbRecipientInfo {
  name: string | null
  idNumber?: string
  fspName?: string
}

/**
 * Verify the registered name on the destination account before disbursing.
 * Never throws — returns { name: null } on any failure.
 * Sandbox needs no checksum here (disburse does); pending confirmation for prod.
 */
export async function lookupRecipientName(phone: string): Promise<DisbRecipientInfo> {
  const accountNumber = normalizeDisbPhone(phone)
  const bankName = azamPayBankFor(accountNumber)
  if (!bankName) {
    console.warn('[azampay/disb] namelookup skipped — provider not enabled for', accountNumber.slice(0, 6) + '****')
    return { name: null }
  }
  try {
    const token = await getDisbursementToken()
    const res = await fetch(`${disbBase()}/api/v1/azampay/namelookup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankName, accountNumber }),
      signal: AbortSignal.timeout(15_000),
    })
    const r = await res.json() as {
      status?: boolean; name?: string; fName?: string; lName?: string
      idNumber?: string; fspName?: string; message?: string
    }
    if (!r.status) {
      console.warn('[azampay/disb] namelookup failed:', r.message)
      return { name: null }
    }
    const name = (r.name ?? [r.fName, r.lName].filter(Boolean).join(' ')) || null
    return { name, idNumber: r.idNumber, fspName: r.fspName }
  } catch (err) {
    console.warn('[azampay/disb] namelookup error (non-fatal):', err instanceof Error ? err.message : err)
    return { name: null }
  }
}

// ─── Payout ───────────────────────────────────────────────────────────────────

export interface DisbPayoutRequest {
  amountTzs: number
  recipientPhone: string
  recipientName: string
  narration?: string
  webhookUrl?: string
  metadata?: Record<string, unknown>
  /**
   * Stable key so a retry reuses the SAME externalReferenceId. Pass the caller's
   * idempotency key (e.g. burnRequestId) wherever one exists.
   */
  idempotencyKey?: string
}

export interface DisbPayoutResponse {
  success: boolean
  /** AzamPay pgReferenceId — the tracking id for status/callbacks. */
  reference?: string
  /** The externalReferenceId we sent (echoed back on callbacks as initiatorReferenceId). */
  externalReference?: string
  error?: string
  /**
   * AzamPay rejected this as a DUPLICATE externalReferenceId.
   *
   * ⚠ CRITICAL: this is NOT a failed payout. It means an EARLIER submission with
   * the same reference was ACCEPTED (the money is in flight or already paid).
   * AzamPay signals it with success:false and does NOT return the original
   * pgReferenceId — so a naive caller reads it as "payout failed" and re-mints,
   * handing the customer the TZS *and* the nTZS and minting unbacked supply.
   *
   * Callers MUST NOT treat duplicate as failure and MUST NOT revert/re-mint.
   * Verified against the AzamPay sandbox 2026-07-15:
   *   "Detected duplicate transaction: Duplicate ExternalReferenceId: <ref>"
   */
  duplicate?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isTransient(status: number, message?: string): boolean {
  if (status >= 500) return true
  const m = (message || '').toLowerCase()
  return m.includes('temporarily') || m.includes('unavailable') || m.includes('try again') || m.includes('timeout')
}

/** AzamPay's duplicate-reference rejection — means the ORIGINAL was accepted. */
function isDuplicateRejection(message?: string): boolean {
  const m = (message || '').toLowerCase()
  return m.includes('duplicate')
}

/**
 * Disburse to a mobile-money account.
 *
 * SAFETY: externalReferenceId, epochDate and the checksum are computed ONCE and
 * reused across retries. The previous implementation generated a fresh UUID per
 * attempt, which would defeat AzamPay's de-duplication and risk DOUBLE-PAYING.
 * (Whether AzamPay actually de-duplicates on externalReferenceId is still to be
 * confirmed — until it is, retries remain a residual risk and are capped.)
 */
export async function sendPayout(request: DisbPayoutRequest): Promise<DisbPayoutResponse> {
  const destAcc = normalizeDisbPhone(request.recipientPhone)
  const bankName = azamPayBankFor(destAcc)
  if (!bankName) {
    return { success: false, error: 'Vodacom (M-Pesa) payouts are not enabled on this account yet' }
  }

  const sourceAcc = sourceAccount()
  const amount = String(Math.trunc(request.amountTzs))
  const epochDate = Math.floor(Date.now() / 1000)
  const externalReferenceId = makeExternalReferenceId(request.idempotencyKey)
  const checksum = disbursementChecksum({
    sourceAcc, destAcc, currency: CURRENCY, amount, epochDate, externalReferenceId,
  })

  const body = {
    source: {
      countryCode: 'TZ', fullName: sourceName(), bankName: sourceBank(),
      accountNumber: sourceAcc, currency: CURRENCY,
    },
    destination: {
      countryCode: 'TZ', fullName: request.recipientName, bankName,
      accountNumber: destAcc, currency: CURRENCY,
    },
    transferDetails: { type: transferType(), amount: Number(amount), dateInEpoch: epochDate },
    externalReferenceId,
    remarks: request.narration || 'nTZS redemption',
    checksum,
    ...(request.metadata || request.webhookUrl
      ? {
          additionalProperties: {
            ...(request.metadata ?? {}),
            ...(request.webhookUrl?.startsWith('https://') ? { webhookUrl: request.webhookUrl } : {}),
          },
        }
      : {}),
  }

  const MAX_ATTEMPTS = 3
  const BACKOFF_MS = [0, 1000, 3000]
  let lastError: string | undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt] > 0) await sleep(BACKOFF_MS[attempt])
    try {
      const token = await getDisbursementToken()
      const res = await fetch(`${disbBase()}/api/v1/azampay/disburse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      const r = await res.json() as {
        success?: boolean; pgReferenceId?: string | null
        message?: string; statusCode?: number; status?: string
      }

      if (r.success && r.pgReferenceId) {
        console.log('[azampay/disb] payout accepted', {
          pgReferenceId: r.pgReferenceId, externalReferenceId, amount, bankName, status: r.status,
        })
        return { success: true, reference: r.pgReferenceId, externalReference: externalReferenceId }
      }

      // A duplicate means an EARLIER attempt was ACCEPTED — the money is in flight.
      // Never retry it and never let the caller read it as a failure (that would
      // trigger a re-mint and break the peg). Surface it explicitly instead.
      if (isDuplicateRejection(r.message)) {
        console.warn('[azampay/disb] DUPLICATE reference — original submission was accepted; do NOT revert', {
          externalReferenceId, message: r.message,
        })
        return { success: false, duplicate: true, externalReference: externalReferenceId, error: r.message }
      }

      lastError = r.message || 'Payout initiation failed'
      const retryable = isTransient(res.status, r.message)
      console.error('[azampay/disb] payout failed', {
        attempt: attempt + 1, httpStatus: res.status, error: lastError, retryable, externalReferenceId,
      })
      if (!retryable) break
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Failed to reach AzamPay disbursement'
      console.error('[azampay/disb] payout error', { attempt: attempt + 1, error: lastError, externalReferenceId })
    }
  }

  return { success: false, error: lastError || 'Payout initiation failed', externalReference: externalReferenceId }
}

export interface DisbBankPayoutRequest {
  amountTzs: number
  recipientName: string
  bankAccount: string
  bankName: string
  narration?: string
  webhookUrl?: string
  metadata?: Record<string, unknown>
  idempotencyKey?: string
}

/**
 * Disburse to a bank account — same endpoint and contract, bank destination.
 * ⚠ Bank destination not yet sandbox-verified (only Azampesa MNO was).
 */
export async function sendBankPayout(request: DisbBankPayoutRequest): Promise<DisbPayoutResponse> {
  const sourceAcc = sourceAccount()
  const destAcc = request.bankAccount
  const amount = String(Math.trunc(request.amountTzs))
  const epochDate = Math.floor(Date.now() / 1000)
  const externalReferenceId = makeExternalReferenceId(request.idempotencyKey)
  const checksum = disbursementChecksum({
    sourceAcc, destAcc, currency: CURRENCY, amount, epochDate, externalReferenceId,
  })

  try {
    const token = await getDisbursementToken()
    const res = await fetch(`${disbBase()}/api/v1/azampay/disburse`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: {
          countryCode: 'TZ', fullName: sourceName(), bankName: sourceBank(),
          accountNumber: sourceAcc, currency: CURRENCY,
        },
        destination: {
          countryCode: 'TZ', fullName: request.recipientName, bankName: request.bankName,
          accountNumber: destAcc, currency: CURRENCY,
        },
        transferDetails: { type: process.env.AZAMPAY_DISB_BANK_TYPE || 'BANK', amount: Number(amount), dateInEpoch: epochDate },
        externalReferenceId,
        remarks: request.narration || 'nTZS redemption',
        checksum,
        ...(request.metadata || request.webhookUrl
          ? {
              additionalProperties: {
                ...(request.metadata ?? {}),
                ...(request.webhookUrl?.startsWith('https://') ? { webhookUrl: request.webhookUrl } : {}),
              },
            }
          : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const r = await res.json() as { success?: boolean; pgReferenceId?: string | null; message?: string }
    if (r.success && r.pgReferenceId) {
      return { success: true, reference: r.pgReferenceId, externalReference: externalReferenceId }
    }
    // See DisbPayoutResponse.duplicate — an accepted original, never a failure.
    if (isDuplicateRejection(r.message)) {
      console.warn('[azampay/disb] DUPLICATE reference on bank payout — original accepted; do NOT revert', { externalReferenceId })
      return { success: false, duplicate: true, externalReference: externalReferenceId, error: r.message }
    }
    return { success: false, error: r.message || 'Bank payout failed', externalReference: externalReferenceId }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to reach AzamPay disbursement',
      externalReference: externalReferenceId,
    }
  }
}
