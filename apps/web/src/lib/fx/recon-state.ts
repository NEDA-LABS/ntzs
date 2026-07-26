import { eq } from 'drizzle-orm'

import { fxReconState } from '@ntzs/db'
import type { getDb } from '@/lib/db'

type Db = ReturnType<typeof getDb>['db']

/**
 * Fail-soft accessors for fx_recon_state. The table ships as a hand-applied
 * migration (drizzle/0065), so every call tolerates it not existing yet — the
 * cron and the backstage card degrade instead of erroring.
 */

/** True when the fx_recon_state table exists (migration 0065 applied). */
export async function reconStateAvailable(db: Db): Promise<boolean> {
  try {
    await db.select({ key: fxReconState.key }).from(fxReconState).limit(1)
    return true
  } catch {
    return false
  }
}

export async function readReconState<T>(db: Db, key: string): Promise<T | null> {
  try {
    const rows = await db
      .select({ value: fxReconState.value })
      .from(fxReconState)
      .where(eq(fxReconState.key, key))
      .limit(1)
    return (rows[0]?.value as T | undefined) ?? null
  } catch (err) {
    console.warn(`[recon-state] read ${key} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

export async function writeReconState(db: Db, key: string, value: unknown): Promise<boolean> {
  try {
    await db
      .insert(fxReconState)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: fxReconState.key, set: { value, updatedAt: new Date() } })
    return true
  } catch (err) {
    console.warn(`[recon-state] write ${key} failed:`, err instanceof Error ? err.message : err)
    return false
  }
}
