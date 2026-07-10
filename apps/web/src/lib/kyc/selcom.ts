/**
 * Selcom Identity (NIDA) KYC verification client.
 *
 * POST {SELCOM_IDENTITY_URL}/neda/get_user_data_by_nida with headers
 * api_key + api_digest, where api_digest = SHA-256(api_key + api_secret) hex —
 * per Selcom's NEDA Labs Postman collection. Given a NIDA (Tanzanian National
 * ID) number it returns the registered holder's records; we treat a positive
 * match as the KYC-verified identity required by BoT Testing Parameter 8 and
 * record it as a kyc_cases row (provider 'selcom_nida').
 *
 * FAIL-CLOSED by design: missing credentials, network errors, or an
 * unrecognized response shape all yield 'unavailable' — never 'verified'.
 * PII discipline: this module never logs response bodies; callers get typed
 * fields plus a key-list (shape only) for auditability.
 */
import { createHash } from 'node:crypto'

/** api_digest = SHA-256(api_key + api_secret), hex — Selcom's scheme. */
export function computeSelcomDigest(apiKey: string, apiSecret: string): string {
  return createHash('sha256').update(apiKey + apiSecret).digest('hex')
}

/** NIDA numbers are 20 digits, commonly formatted XXXXXXXX-XXXXX-XXXXX-XX. */
export function normalizeNidaNumber(input: string): string | null {
  const digits = (input ?? '').replace(/[\s-]/g, '')
  if (!/^\d{20}$/.test(digits)) return null
  return digits
}

export type SelcomVerification =
  | { status: 'verified'; reference: string | null; fullName: string | null; responseKeys: string[] }
  | { status: 'not_found'; message: string | null; responseKeys: string[] }
  | { status: 'unavailable'; error: string }

/**
 * Interpret a Selcom identity response defensively (pure, unit-tested).
 * 'verified' requires an explicit success signal AND a data record;
 * anything ambiguous is 'unavailable' (fail closed), an explicit negative is
 * 'not_found'.
 */
export function interpretSelcomResponse(httpStatus: number, body: unknown): SelcomVerification {
  const keys = body && typeof body === 'object' ? Object.keys(body as Record<string, unknown>) : []
  if (httpStatus < 200 || httpStatus >= 300 || !body || typeof body !== 'object') {
    return { status: 'unavailable', error: `HTTP ${httpStatus}` }
  }

  const o = body as Record<string, unknown>
  const resultRaw = String(o.result ?? o.status ?? '').toUpperCase()
  const resultCode = String(o.resultcode ?? o.result_code ?? o.code ?? '')
  const succeeded = resultRaw === 'SUCCESS' || resultRaw === 'OK' || resultCode === '000' || resultCode === '200'
  const failed = resultRaw === 'FAIL' || resultRaw === 'FAILED' || resultRaw === 'ERROR' || (resultCode !== '' && !succeeded)

  // The record may come as data (object or array), user, or record.
  const container = o.data ?? o.user ?? o.record ?? null
  const record: Record<string, unknown> | null = Array.isArray(container)
    ? ((container[0] as Record<string, unknown>) ?? null)
    : container && typeof container === 'object'
      ? (container as Record<string, unknown>)
      : null

  if (succeeded && record && Object.keys(record).length > 0) {
    const first = record.firstname ?? record.first_name ?? record.firstName ?? ''
    const middle = record.middlename ?? record.middle_name ?? record.othernames ?? ''
    const last = record.surname ?? record.lastname ?? record.last_name ?? record.lastName ?? ''
    const joined = [first, middle, last].map((p) => String(p ?? '').trim()).filter(Boolean).join(' ')
    const fullName = joined || (typeof record.fullname === 'string' ? record.fullname : null)
    const reference =
      (typeof o.reference === 'string' && o.reference) ||
      (typeof o.transid === 'string' && o.transid) ||
      (typeof record.reference === 'string' && record.reference) ||
      null
    return { status: 'verified', reference, fullName: fullName || null, responseKeys: keys }
  }

  if (failed || (succeeded && !record)) {
    const message = typeof o.message === 'string' ? o.message : null
    return { status: 'not_found', message, responseKeys: keys }
  }

  return { status: 'unavailable', error: 'Unrecognized response shape' }
}

/**
 * Verify a NIDA number against Selcom Identity. Fail-closed: any configuration,
 * network, or shape problem returns 'unavailable' — callers must not issue a
 * wallet on anything except 'verified'.
 */
export async function verifyNidaNumber(nidaNumber: string): Promise<SelcomVerification> {
  const apiKey = process.env.SELCOM_IDENTITY_API_KEY
  const apiSecret = process.env.SELCOM_IDENTITY_API_SECRET
  const baseUrl = (process.env.SELCOM_IDENTITY_URL || 'https://identity.selcommobile.com/api/v2').replace(/\/$/, '')

  if (!apiKey || !apiSecret) {
    return { status: 'unavailable', error: 'SELCOM_IDENTITY_API_KEY / SELCOM_IDENTITY_API_SECRET not configured' }
  }

  const normalized = normalizeNidaNumber(nidaNumber)
  if (!normalized) {
    return { status: 'not_found', message: 'Invalid NIDA number format (20 digits required)', responseKeys: [] }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const res = await fetch(`${baseUrl}/neda/get_user_data_by_nida`, {
      method: 'POST',
      headers: {
        api_key: apiKey,
        api_digest: computeSelcomDigest(apiKey, apiSecret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nida_number: normalized }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      return { status: 'unavailable', error: `Non-JSON response (HTTP ${res.status})` }
    }
    return interpretSelcomResponse(res.status, body)
  } catch (err) {
    return { status: 'unavailable', error: err instanceof Error ? err.message : 'Network error' }
  }
}
