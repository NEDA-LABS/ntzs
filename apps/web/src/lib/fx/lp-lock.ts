import { getDb } from '@/lib/db'

/** Sentinel returned by withLpOpLock when the LP's lock is already held. */
export const LP_LOCK_BUSY = Symbol('lp_lock_busy')

/**
 * How long a lock survives if its holder crashes. Must exceed the activate
 * route's maxDuration so a live run is never treated as abandoned.
 */
const LOCK_TTL_MINUTES = 10

/**
 * Serialize a money-moving operation (activate / deactivate) for a single LP.
 *
 * Two concurrent calls for the same LP — e.g. a double-clicked button — must not
 * both run: for deactivate, two requests could otherwise both read the same
 * positions and both pay them out from the shared solver (a double-spend).
 *
 * Implemented as a TTL row lock (bucket `lp_op_lock:<lpId>` in rate_limits)
 * rather than a Postgres session advisory lock: the app connects through
 * Neon's transaction-mode pooler, where an advisory lock attaches to whatever
 * pooled BACKEND happens to run the statement. A function killed mid-run (e.g.
 * at the platform timeout) strands the lock on that backend indefinitely, and
 * the unlock can land on a different backend — the LP then gets 409 forever.
 * A plain row with an expiry is pooler-safe and self-heals: a crashed run's
 * lock evaporates after LOCK_TTL_MINUTES.
 *
 * Non-blocking: if another call holds an unexpired lock, returns LP_LOCK_BUSY
 * so the caller can reply 409 rather than queueing.
 */
export async function withLpOpLock<T>(
  lpId: string,
  fn: () => Promise<T>,
): Promise<T | typeof LP_LOCK_BUSY> {
  const { sql } = getDb()
  const bucket = `lp_op_lock:${lpId}`

  // Acquire: insert wins; an existing row only yields if its TTL has lapsed.
  const rows = await sql<{ bucket: string }[]>`
    insert into rate_limits (bucket, count, expires_at)
    values (${bucket}, 1, now() + make_interval(mins => ${LOCK_TTL_MINUTES}))
    on conflict (bucket) do update
      set expires_at = excluded.expires_at
      where rate_limits.expires_at < now()
    returning bucket
  `
  if (rows.length === 0) return LP_LOCK_BUSY

  try {
    return await fn()
  } finally {
    await sql`delete from rate_limits where bucket = ${bucket}`.catch(() => {})
  }
}
