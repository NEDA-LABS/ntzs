import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { depositRequests, burnRequests } from '@ntzs/db'

/**
 * GET /api/stats/volume
 *
 * Public aggregate for the landing page: lifetime TZS volume processed
 * through the platform — completed issuance (minted deposits) plus completed
 * redemptions (burned + paid out). Aggregate-only, no per-user data. Cached
 * at the edge so public traffic never hammers the database.
 */
export async function GET() {
  try {
    const { db } = getDb()

    const [minted] = await db
      .select({
        total: sql<number>`coalesce(sum(${depositRequests.amountTzs}) filter (where ${depositRequests.status} = 'minted'), 0)`.mapWith(Number),
      })
      .from(depositRequests)

    const [burned] = await db
      .select({
        total: sql<number>`coalesce(sum(${burnRequests.amountTzs}) filter (where ${burnRequests.status} = 'burned'), 0)`.mapWith(Number),
      })
      .from(burnRequests)

    const mintedTzs = minted?.total ?? 0
    const redeemedTzs = burned?.total ?? 0

    return NextResponse.json(
      {
        totalProcessedTzs: mintedTzs + redeemedTzs,
        mintedTzs,
        redeemedTzs,
      },
      {
        headers: {
          // 5 min edge cache + 10 min stale-while-revalidate: fresh enough
          // for a marketing stat, one DB hit per window regardless of traffic.
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    )
  } catch (err) {
    console.error('[stats/volume]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
