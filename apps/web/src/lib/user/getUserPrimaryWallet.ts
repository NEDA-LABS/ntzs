import { and, eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { wallets } from '@ntzs/db'

type Wallet = typeof wallets.$inferSelect

/**
 * Returns the canonical wallet for a user — the one that MUST be used for
 * new deposit requests so that minted tokens go to the wallet shown on the
 * user's dashboard.
 *
 * Resolution order:
 *  1. platform_hd (used by dashboard + swaps)
 *  2. any base-chain wallet (fallback for legacy users)
 *
 * This MUST match `getCachedWallet` in `cachedWallet.ts`. If you change one,
 * change both.
 */
export async function getUserPrimaryWallet(userId: string): Promise<Wallet | null> {
  const { db } = getDb()

  const preferred = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, userId), eq(wallets.provider, 'platform_hd')),
  })
  if (preferred) return preferred

  const fallback = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, userId), eq(wallets.chain, 'base')),
  })
  return fallback ?? null
}
