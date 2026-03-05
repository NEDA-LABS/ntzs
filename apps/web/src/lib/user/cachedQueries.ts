import { eq, desc, and } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { depositRequests, burnRequests, kycCases, banks } from '@ntzs/db'
import { MemCache } from '@/lib/cache'

// 15s TTL — fresh enough for financial data, fast enough to skip Neon
const depositsCache = new MemCache<typeof depositRequests.$inferSelect[]>(15_000)
const burnsCache = new MemCache<{ id: string; amountTzs: number; status: string; createdAt: Date | null }[]>(15_000)
const kycCache = new MemCache<{ id: string; status: string; createdAt: Date | null }[]>(15_000)
const bankCache = new MemCache<typeof banks.$inferSelect | null>(30_000)

export async function getCachedRecentDeposits(userId: string, limit = 5) {
  const key = `${userId}:${limit}`
  const cached = depositsCache.get(key)
  if (cached) return cached

  const { db } = getDb()
  const result = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.userId, userId))
    .orderBy(desc(depositRequests.createdAt))
    .limit(limit)

  depositsCache.set(key, result)
  return result
}

export async function getCachedRecentBurns(userId: string, limit = 5) {
  const key = `${userId}:${limit}`
  const cached = burnsCache.get(key)
  if (cached) return cached

  const { db } = getDb()
  const result = await db
    .select({
      id: burnRequests.id,
      amountTzs: burnRequests.amountTzs,
      status: burnRequests.status,
      createdAt: burnRequests.createdAt,
    })
    .from(burnRequests)
    .where(eq(burnRequests.userId, userId))
    .orderBy(desc(burnRequests.createdAt))
    .limit(limit)

  burnsCache.set(key, result)
  return result
}

export async function getCachedApprovedKyc(userId: string) {
  const cached = kycCache.get(userId)
  if (cached) return cached

  const { db } = getDb()
  const result = await db
    .select({ id: kycCases.id, status: kycCases.status, createdAt: kycCases.createdAt })
    .from(kycCases)
    .where(and(eq(kycCases.userId, userId), eq(kycCases.status, 'approved')))
    .limit(1)

  kycCache.set(userId, result)
  return result
}

export async function getCachedLatestKyc(userId: string) {
  const key = `latest:${userId}`
  const cached = kycCache.get(key)
  if (cached) return cached

  const { db } = getDb()
  const result = await db
    .select({ id: kycCases.id, status: kycCases.status, createdAt: kycCases.createdAt })
    .from(kycCases)
    .where(eq(kycCases.userId, userId))
    .orderBy(desc(kycCases.createdAt))
    .limit(1)

  kycCache.set(key, result)
  return result
}

export async function getCachedDefaultBank() {
  const cached = bankCache.get('default')
  if (cached !== undefined) return cached

  const { db } = getDb()
  const result = await db.query.banks.findFirst({
    where: eq(banks.status, 'active'),
  }) ?? null

  bankCache.set('default', result)
  return result
}
