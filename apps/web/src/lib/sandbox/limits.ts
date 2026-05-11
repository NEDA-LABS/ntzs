import { and, eq, gte, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { depositRequests, burnRequests } from '@ntzs/db'

// BoT Testing Parameters #2, #3, #4, #5
export const SANDBOX_USER_CAP = Number(process.env.SANDBOX_USER_CAP ?? '100')
export const SANDBOX_PER_TXN_CAP_TZS = Number(process.env.SANDBOX_PER_TXN_CAP_TZS ?? '1000000')
export const SANDBOX_DAILY_USER_CAP_TZS = Number(process.env.SANDBOX_DAILY_USER_CAP_TZS ?? '2000000')
export const SANDBOX_MONTHLY_USER_CAP_TZS = Number(process.env.SANDBOX_MONTHLY_USER_CAP_TZS ?? '60000000')

// Deposit statuses that count toward user limits (exclude terminal failures)
const COUNTED_DEPOSIT_STATUSES = [
  'submitted', 'kyc_pending', 'kyc_approved', 'awaiting_fiat',
  'fiat_confirmed', 'bank_approved', 'platform_approved',
  'mint_pending', 'mint_requires_safe', 'mint_processing', 'minted',
]

// Burn statuses that count toward user limits
const COUNTED_BURN_STATUSES = [
  'requested', 'approved', 'requires_second_approval',
  'burn_submitted', 'burned',
]

export type LimitError = {
  code: 'per_txn_cap' | 'daily_user_cap' | 'monthly_user_cap'
  message: string
  limit: number
  requested: number
  used?: number
}

export function checkPerTransactionCap(amountTzs: number): LimitError | null {
  if (amountTzs > SANDBOX_PER_TXN_CAP_TZS) {
    return {
      code: 'per_txn_cap',
      message: `Transaction amount exceeds the sandbox per-transaction limit of TZS ${SANDBOX_PER_TXN_CAP_TZS.toLocaleString()}.`,
      limit: SANDBOX_PER_TXN_CAP_TZS,
      requested: amountTzs,
    }
  }
  return null
}

export async function checkUserPeriodLimits(
  userId: string,
  amountTzs: number,
): Promise<LimitError | null> {
  const { db } = getDb()
  const now = new Date()

  const startOfToday = new Date(now)
  startOfToday.setUTCHours(0, 0, 0, 0)

  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30)

  // Run both period queries in parallel
  const [dailyRows, monthlyRows] = await Promise.all([
    // Daily: deposits + burns created today for this user
    Promise.all([
      db
        .select({ total: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number) })
        .from(depositRequests)
        .where(
          and(
            eq(depositRequests.userId, userId),
            gte(depositRequests.createdAt, startOfToday),
            sql`${depositRequests.status} = any(${COUNTED_DEPOSIT_STATUSES})`,
          )
        ),
      db
        .select({ total: sql<number>`coalesce(sum(${burnRequests.amountTzs}), 0)`.mapWith(Number) })
        .from(burnRequests)
        .where(
          and(
            eq(burnRequests.userId, userId),
            gte(burnRequests.createdAt, startOfToday),
            sql`${burnRequests.status} = any(${COUNTED_BURN_STATUSES})`,
          )
        ),
    ]),

    // Monthly: deposits + burns in last 30 days
    Promise.all([
      db
        .select({ total: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number) })
        .from(depositRequests)
        .where(
          and(
            eq(depositRequests.userId, userId),
            gte(depositRequests.createdAt, thirtyDaysAgo),
            sql`${depositRequests.status} = any(${COUNTED_DEPOSIT_STATUSES})`,
          )
        ),
      db
        .select({ total: sql<number>`coalesce(sum(${burnRequests.amountTzs}), 0)`.mapWith(Number) })
        .from(burnRequests)
        .where(
          and(
            eq(burnRequests.userId, userId),
            gte(burnRequests.createdAt, thirtyDaysAgo),
            sql`${burnRequests.status} = any(${COUNTED_BURN_STATUSES})`,
          )
        ),
    ]),
  ])

  const [[dailyDeposits], [dailyBurns]] = dailyRows
  const [[monthlyDeposits], [monthlyBurns]] = monthlyRows

  const dailyUsed = (dailyDeposits?.total ?? 0) + (dailyBurns?.total ?? 0)
  const monthlyUsed = (monthlyDeposits?.total ?? 0) + (monthlyBurns?.total ?? 0)

  if (dailyUsed + amountTzs > SANDBOX_DAILY_USER_CAP_TZS) {
    return {
      code: 'daily_user_cap',
      message: `This transaction would exceed your daily sandbox limit of TZS ${SANDBOX_DAILY_USER_CAP_TZS.toLocaleString()}. Used today: TZS ${dailyUsed.toLocaleString()}.`,
      limit: SANDBOX_DAILY_USER_CAP_TZS,
      requested: amountTzs,
      used: dailyUsed,
    }
  }

  if (monthlyUsed + amountTzs > SANDBOX_MONTHLY_USER_CAP_TZS) {
    return {
      code: 'monthly_user_cap',
      message: `This transaction would exceed your 30-day sandbox limit of TZS ${SANDBOX_MONTHLY_USER_CAP_TZS.toLocaleString()}. Used in last 30 days: TZS ${monthlyUsed.toLocaleString()}.`,
      limit: SANDBOX_MONTHLY_USER_CAP_TZS,
      requested: amountTzs,
      used: monthlyUsed,
    }
  }

  return null
}

export function limitErrorResponse(err: LimitError) {
  return {
    error: err.code,
    message: err.message,
    details: {
      limit: err.limit,
      requested: err.requested,
      ...(err.used !== undefined ? { usedInPeriod: err.used } : {}),
    },
  }
}
