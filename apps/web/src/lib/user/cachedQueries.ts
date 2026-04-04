import { eq, desc, and, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { depositRequests, burnRequests, kycCases, banks, auditLogs, lpFills, wallets } from '@ntzs/db'
import { MemCache } from '@/lib/cache'

// 15s TTL — fresh enough for financial data, fast enough to skip Neon
const depositsCache = new MemCache<typeof depositRequests.$inferSelect[]>(15_000)
const burnsCache = new MemCache<{ id: string; amountTzs: number; status: string; createdAt: Date | null }[]>(15_000)
const sendsCache = new MemCache<{ id: string; amountTzs: number; toAddress: string; burnTxHash: string; mintTxHash: string; createdAt: Date | null }[]>(15_000)
const kycCache = new MemCache<{ id: string; status: string; createdAt: Date | null }[]>(15_000)
const swapsCache = new MemCache<{ id: string; fromToken: string; toToken: string; amountIn: string; amountOut: string; outTxHash: string; createdAt: Date }[]>(15_000)
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

export async function getCachedRecentSends(userId: string, limit = 50) {
  const key = `${userId}:${limit}`
  const cached = sendsCache.get(key)
  if (cached) return cached

  const { db } = getDb()
  const rows = await db
    .select({
      id: auditLogs.id,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'user_send_ntzs'),
        sql`${auditLogs.metadata}->>'fromUserId' = ${userId}`
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)

  const result = rows.map((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>
    return {
      id: r.id,
      amountTzs: Number(m.amountTzs ?? 0),
      toAddress: String(m.toAddress ?? ''),
      burnTxHash: String(m.burnTxHash ?? ''),
      mintTxHash: String(m.mintTxHash ?? ''),
      createdAt: r.createdAt,
    }
  })

  sendsCache.set(key, result)
  return result
}

export function invalidateSendsCache(userId: string) {
  sendsCache.invalidate(`${userId}:50`)
}

export async function getCachedRecentSwaps(userId: string, limit = 50) {
  const key = `${userId}:${limit}`
  const cached = swapsCache.get(key)
  if (cached) return cached

  const { db } = getDb()

  // Look up the user's platform_hd wallet address
  const wallet = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, userId), eq(wallets.provider, 'platform_hd')),
  })

  if (!wallet) {
    swapsCache.set(key, [])
    return []
  }

  const userAddress = wallet.address.toLowerCase()

  const rows = await db
    .select({
      id: lpFills.id,
      fromToken: lpFills.fromToken,
      toToken: lpFills.toToken,
      amountIn: lpFills.amountIn,
      amountOut: lpFills.amountOut,
      outTxHash: lpFills.outTxHash,
      createdAt: lpFills.createdAt,
    })
    .from(lpFills)
    .where(sql`lower(${lpFills.userAddress}) = ${userAddress}`)
    .orderBy(desc(lpFills.createdAt))
    .limit(limit)

  swapsCache.set(key, rows)
  return rows
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

export function invalidateKycCache(userId: string) {
  kycCache.invalidate(userId)
  kycCache.invalidate(`latest:${userId}`)
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
