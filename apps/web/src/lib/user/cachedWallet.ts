import { eq, and, desc } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { wallets } from '@ntzs/db'
import { MemCache } from '@/lib/cache'

type Wallet = typeof wallets.$inferSelect

const walletCache = new MemCache<Wallet | null>(30_000)

export async function getCachedWallet(userId: string): Promise<Wallet | null> {
  const cached = walletCache.get(userId)
  if (cached !== undefined) return cached

  const { db } = getDb()

  // Prefer the platform_hd wallet (used for swaps), fall back to any wallet
  const wallet = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, userId), eq(wallets.provider, 'platform_hd')),
  }) ?? await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
  }) ?? null

  walletCache.set(userId, wallet)
  return wallet
}

export function invalidateWalletCache(userId: string) {
  walletCache.invalidate(userId)
}
