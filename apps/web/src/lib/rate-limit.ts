import { getDb } from '@/lib/db'

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSec: number) {
    super('Rate limit exceeded')
    this.name = 'RateLimitError'
  }
}

/**
 * DB-backed fixed-window rate limit, durable across serverless instances (unlike
 * per-process memory, which each Vercel lambda holds separately). Atomically
 * increments a per-(key, window) counter and throws {@link RateLimitError} once it
 * exceeds `limit` within `windowSec`.
 *
 *   bucket = `${key}:${windowStartEpoch}`  → one row per key per window
 */
export async function enforceRateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const { sql } = getDb()
  const now = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(now / windowSec) * windowSec
  const bucket = `${key}:${windowStart}`
  // Keep the row a little past the window so a late request in the same window
  // still sees the count; expired rows are pruned opportunistically below.
  const expiresAt = new Date((windowStart + windowSec * 2) * 1000)

  const [row] = await sql<{ count: number }[]>`
    insert into rate_limits (bucket, count, expires_at)
    values (${bucket}, 1, ${expiresAt})
    on conflict (bucket) do update set count = rate_limits.count + 1
    returning count
  `

  if (row && row.count > limit) {
    throw new RateLimitError(windowStart + windowSec - now)
  }

  // Best-effort prune of expired buckets, sampled so it costs ~nothing per request.
  if (Math.random() < 0.01) {
    await sql`delete from rate_limits where expires_at < now()`.catch(() => {})
  }
}

const SWAP_RATE_LIMIT_PER_MIN = Number(process.env.FX_SWAP_RATE_LIMIT_PER_MIN ?? 30)

/**
 * Per-identity swap throttle. Returns a 429 `Response` when the caller has exceeded
 * the limit this minute, or `null` to proceed. Limit is env-tunable via
 * FX_SWAP_RATE_LIMIT_PER_MIN (default 30/min).
 */
export async function swapRateLimit(key: string): Promise<Response | null> {
  try {
    await enforceRateLimit(key, SWAP_RATE_LIMIT_PER_MIN, 60)
    return null
  } catch (err) {
    if (err instanceof RateLimitError) {
      return new Response(
        JSON.stringify({ error: 'Too many swap requests. Please slow down and try again shortly.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(err.retryAfterSec) } },
      )
    }
    throw err
  }
}
