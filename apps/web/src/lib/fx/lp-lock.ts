import { getDb } from '@/lib/db'

/** Sentinel returned by withLpOpLock when the LP's lock is already held. */
export const LP_LOCK_BUSY = Symbol('lp_lock_busy')

/**
 * Serialize a money-moving operation (activate / deactivate) for a single LP.
 *
 * Two concurrent calls for the same LP — e.g. a double-clicked button — must not
 * both run: for deactivate, two requests could each read the same positions and
 * both pay them out from the shared solver (a double-spend). This takes a Postgres
 * SESSION advisory lock on a reserved connection, held across the on-chain transfers
 * (a transaction-scoped lock can't safely span multi-second `tx.wait()` calls). The
 * lock is non-blocking: if another call already holds it, returns `LP_LOCK_BUSY` so
 * the caller can reply 409 rather than queueing.
 *
 * The lock key is per-LP, so different LPs never block each other.
 */
export async function withLpOpLock<T>(
  lpId: string,
  fn: () => Promise<T>,
): Promise<T | typeof LP_LOCK_BUSY> {
  const { sql } = getDb()
  const key = `lp_activate:${lpId}`
  const conn = await sql.reserve()
  try {
    const [{ locked }] = await conn<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${key})) as locked
    `
    if (!locked) return LP_LOCK_BUSY
    try {
      return await fn()
    } finally {
      // Release on the SAME reserved connection the lock was taken on.
      await conn`select pg_advisory_unlock(hashtext(${key}))`.catch(() => {})
    }
  } finally {
    conn.release()
  }
}
