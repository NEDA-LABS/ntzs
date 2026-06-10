/**
 * Shared OTP verification core — brute-force resistant.
 *
 * All three OTP sign-in flows (merchant / enterprise / fx-LP) have identical
 * code tables and were previously vulnerable to unlimited guessing: a 6-digit
 * code with no per-code attempt cap and no issuance throttle can be brute-forced
 * within its validity window. This module centralises the hardened logic so the
 * three flows can't drift apart.
 *
 * Defences:
 *   1. Per-code attempt cap — a code is burned after MAX_ATTEMPTS wrong guesses.
 *   2. Issuance throttle — limits how many codes an email can request, capping
 *      total guesses across re-issued codes and preventing email-bombing.
 *   3. Timing-safe hash comparison.
 */
import crypto from 'crypto'

import { getDb } from '@/lib/db'

/** OTP tables this module is allowed to touch (guards the dynamic identifier). */
const ALLOWED_TABLES = new Set(['merchant_otp_codes', 'enterprise_otp_codes', 'lp_otp_codes'])
export type OtpTable = 'merchant_otp_codes' | 'enterprise_otp_codes' | 'lp_otp_codes'

/** Wrong guesses allowed per issued code before it is burned. */
const MAX_ATTEMPTS = 5
/** Minimum gap between code requests for the same email. */
const RESEND_COOLDOWN_MS = 60_000
/** Max codes a single email can request per rolling hour. */
const MAX_CODES_PER_HOUR = 5

export class OtpRateLimitError extends Error {
  readonly code = 'OTP_RATE_LIMITED'
  constructor(message = 'Too many code requests. Please wait a minute and try again.') {
    super(message)
    this.name = 'OtpRateLimitError'
  }
}

function assertTable(table: string): asserts table is OtpTable {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Refusing to operate on non-OTP table: ${table}`)
  }
}

export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code.trim()).digest('hex')
}

/** Constant-time comparison of two hex-encoded SHA-256 digests. */
function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ab.length === 0 || ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/**
 * Enforce issuance limits before generating/storing a new code.
 * Throws {@link OtpRateLimitError} when the email is requesting codes too fast.
 */
export async function enforceOtpIssuanceLimit(table: OtpTable, email: string): Promise<void> {
  assertTable(table)
  const { sql } = getDb()
  const normalized = email.toLowerCase().trim()

  const recent = await sql<{ created_at: Date }[]>`
    select created_at
    from ${sql(table)}
    where email = ${normalized}
      and created_at > now() - interval '1 hour'
    order by created_at desc
  `

  if (recent.length >= MAX_CODES_PER_HOUR) throw new OtpRateLimitError()
  if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < RESEND_COOLDOWN_MS) {
    throw new OtpRateLimitError()
  }
}

/**
 * Verify a submitted code against the most recent active code for an email,
 * enforcing the per-code attempt cap.
 *
 * Returns the matched code row id on success, or null on failure (wrong code,
 * no active code, expired, or attempt cap reached).
 *
 * @param markUsedOnSuccess when true (default) the code is consumed immediately
 *   on a correct match. Pass false for flows that defer consumption until a
 *   later step succeeds (they must then mark it used themselves).
 */
export async function verifyOtpCode(
  table: OtpTable,
  email: string,
  code: string,
  { markUsedOnSuccess = true }: { markUsedOnSuccess?: boolean } = {},
): Promise<string | null> {
  assertTable(table)
  const { sql } = getDb()
  const normalized = email.toLowerCase().trim()

  const [row] = await sql<{ id: string; code_hash: string; attempts: number }[]>`
    select id, code_hash, attempts
    from ${sql(table)}
    where email = ${normalized}
      and used = false
      and expires_at > now()
    order by created_at desc
    limit 1
  `

  if (!row) return null

  // Cap reached — burn the code so further guesses are impossible.
  if (row.attempts >= MAX_ATTEMPTS) {
    await sql`update ${sql(table)} set used = true where id = ${row.id}`
    return null
  }

  if (timingSafeEqualHex(row.code_hash, hashOtp(code))) {
    if (markUsedOnSuccess) {
      await sql`update ${sql(table)} set used = true where id = ${row.id}`
    }
    return row.id
  }

  // Wrong guess — increment, and burn the code if this exhausts the budget.
  const nextAttempts = row.attempts + 1
  await sql`
    update ${sql(table)}
    set attempts = ${nextAttempts}, used = ${nextAttempts >= MAX_ATTEMPTS}
    where id = ${row.id}
  `
  return null
}
