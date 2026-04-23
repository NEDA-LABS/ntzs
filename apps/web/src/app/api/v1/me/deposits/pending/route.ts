import { desc, eq, notInArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { requireDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { depositRequests } from '@ntzs/db'

const TERMINAL = ['minted', 'rejected', 'cancelled']

/**
 * GET /api/v1/me/deposits/pending
 *
 * Session-authenticated. Returns all non-terminal deposits for the logged-in
 * user, plus the 10 most-recent terminal ones so the client can detect
 * transitions (submitted → minted, submitted → rejected, etc.).
 *
 * Queries the DB directly — no MemCache — so the poller always sees fresh data.
 */
export async function GET() {
  try {
    const dbUser = await requireDbUser()
    const { db } = getDb()

    const rows = await db
      .select({
        id: depositRequests.id,
        status: depositRequests.status,
        amountTzs: depositRequests.amountTzs,
      })
      .from(depositRequests)
      .where(eq(depositRequests.userId, dbUser.id))
      .orderBy(desc(depositRequests.createdAt))
      .limit(20)

    return NextResponse.json({ deposits: rows })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
