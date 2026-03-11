import { NextRequest, NextResponse } from 'next/server'
import { eq, and, gt, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { savingsPositions, savingsRateConfig, yieldAccruals } from '@ntzs/db'

const CRON_SECRET = process.env.CRON_SECRET || ''

export const maxDuration = 60

/**
 * GET /api/cron/accrue-yield
 *
 * Runs once per day (scheduled via vercel.json).
 * For every active savings position with principal > 0:
 *   daily_yield = floor(principal * rate_bps / 10_000 / 365)
 * Adds to accrued_yield_tzs and writes an audit row to yield_accruals.
 * Idempotent — skips positions already accrued today.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const isVercelCron = request.headers.get('x-vercel-cron') === '1'

    if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { db } = getDb()
    const today = new Date().toISOString().slice(0, 10)

    // Get the current rate (most recent effective_from <= now)
    const [rateRow] = await db
      .select({ annualRateBps: savingsRateConfig.annualRateBps })
      .from(savingsRateConfig)
      .where(sql`${savingsRateConfig.effectiveFrom} <= now()`)
      .orderBy(sql`${savingsRateConfig.effectiveFrom} DESC`)
      .limit(1)

    if (!rateRow) {
      return NextResponse.json({ status: 'skipped', reason: 'no_rate_configured' })
    }

    const rateBps = rateRow.annualRateBps

    // Fetch all active positions with principal > 0
    const positions = await db
      .select({
        id: savingsPositions.id,
        principalTzs: savingsPositions.principalTzs,
        annualRateBps: savingsPositions.annualRateBps,
      })
      .from(savingsPositions)
      .where(and(eq(savingsPositions.status, 'active'), gt(savingsPositions.principalTzs, 0)))

    if (!positions.length) {
      return NextResponse.json({ status: 'ok', processed: 0, date: today })
    }

    let processed = 0
    let skipped = 0

    for (const position of positions) {
      // Use the position's snapshotted rate (protects users if rate changes)
      const positionRateBps = position.annualRateBps
      const dailyYield = Math.floor((position.principalTzs * positionRateBps) / 10_000 / 365)

      if (dailyYield <= 0) {
        skipped++
        continue
      }

      // Idempotent insert — skip if already accrued today
      const inserted = await db
        .insert(yieldAccruals)
        .values({
          positionId: position.id,
          date: today,
          principalTzs: position.principalTzs,
          rateBps: positionRateBps,
          accruedTzs: dailyYield,
        })
        .onConflictDoNothing()
        .returning({ id: yieldAccruals.id })

      if (!inserted.length) {
        skipped++
        continue
      }

      // Add yield to running total on the position
      await db
        .update(savingsPositions)
        .set({
          accruedYieldTzs: sql`${savingsPositions.accruedYieldTzs} + ${dailyYield}`,
          lastAccrualAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(savingsPositions.id, position.id))

      processed++
    }

    console.log(`[cron/accrue-yield] ${today}: processed=${processed} skipped=${skipped} rate=${rateBps}bps`)

    return NextResponse.json({
      status: 'ok',
      date: today,
      rateBps,
      processed,
      skipped,
      total: positions.length,
    })
  } catch (err) {
    console.error('[cron/accrue-yield] error:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
