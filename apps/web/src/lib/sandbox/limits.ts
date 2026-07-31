import { and, eq, gte, inArray, notInArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { depositRequests, burnRequests, rampSettlements, sandboxLimitEvents } from '@ntzs/db'

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
] as const

// Burn statuses that count toward user limits
const COUNTED_BURN_STATUSES = [
  'requested', 'approved', 'requires_second_approval',
  'burn_submitted', 'burned',
] as const

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
            inArray(depositRequests.status, COUNTED_DEPOSIT_STATUSES),
          )
        ),
      db
        .select({ total: sql<number>`coalesce(sum(${burnRequests.amountTzs}), 0)`.mapWith(Number) })
        .from(burnRequests)
        .where(
          and(
            eq(burnRequests.userId, userId),
            gte(burnRequests.createdAt, startOfToday),
            inArray(burnRequests.status, COUNTED_BURN_STATUSES),
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
            inArray(depositRequests.status, COUNTED_DEPOSIT_STATUSES),
          )
        ),
      db
        .select({ total: sql<number>`coalesce(sum(${burnRequests.amountTzs}), 0)`.mapWith(Number) })
        .from(burnRequests)
        .where(
          and(
            eq(burnRequests.userId, userId),
            gte(burnRequests.createdAt, thirtyDaysAgo),
            inArray(burnRequests.status, COUNTED_BURN_STATUSES),
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

/**
 * BoT Parameters #4 & #5 counted against an AGENT FLOAT (partner sub-wallet)
 * instead of a user.
 *
 * ⚠ WHY THIS EXISTS. Sub-wallets sit under a partner treasury, so
 * checkUserPeriodLimits never sees them — which would make an agent float a
 * route around the daily/monthly caps. Counting per sub-wallet keeps a float
 * capped exactly as a user is, so provisioning a second float creates another
 * participant rather than fresh headroom. Any new funding source must get the
 * same treatment before it ships.
 *
 * Only burns are summed: sub-wallets are funded by the partner, not by an
 * end-user deposit, so there is no deposit leg attributable to the float.
 */
export async function checkSubWalletPeriodLimits(
  subWalletId: string,
  amountTzs: number,
): Promise<LimitError | null> {
  const { db } = getDb()
  const now = new Date()

  const startOfToday = new Date(now)
  startOfToday.setUTCHours(0, 0, 0, 0)

  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30)

  const sumBurnsSince = async (since: Date) => {
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${burnRequests.amountTzs}), 0)`.mapWith(Number) })
      .from(burnRequests)
      .where(
        and(
          eq(burnRequests.subWalletId, subWalletId),
          gte(burnRequests.createdAt, since),
          inArray(burnRequests.status, COUNTED_BURN_STATUSES),
        )
      )
    return row?.total ?? 0
  }

  const [dailyUsed, monthlyUsed] = await Promise.all([
    sumBurnsSince(startOfToday),
    sumBurnsSince(thirtyDaysAgo),
  ])

  if (dailyUsed + amountTzs > SANDBOX_DAILY_USER_CAP_TZS) {
    return {
      code: 'daily_user_cap',
      message: `This transaction would exceed the float's daily limit of TZS ${SANDBOX_DAILY_USER_CAP_TZS.toLocaleString()}. Used today: TZS ${dailyUsed.toLocaleString()}.`,
      limit: SANDBOX_DAILY_USER_CAP_TZS,
      requested: amountTzs,
      used: dailyUsed,
    }
  }

  if (monthlyUsed + amountTzs > SANDBOX_MONTHLY_USER_CAP_TZS) {
    return {
      code: 'monthly_user_cap',
      message: `This transaction would exceed the float's 30-day limit of TZS ${SANDBOX_MONTHLY_USER_CAP_TZS.toLocaleString()}. Used in last 30 days: TZS ${monthlyUsed.toLocaleString()}.`,
      limit: SANDBOX_MONTHLY_USER_CAP_TZS,
      requested: amountTzs,
      used: monthlyUsed,
    }
  }

  return null
}

/**
 * The Tanzanian-side wallet a ramp settlement touches: the recipient till,
 * bill account, or mobile wallet for an off-ramp; the payer's mobile wallet
 * for an on-ramp.
 */
export type RampCounterparty =
  | { kind: 'phone'; phone: string }
  | { kind: 'lipa'; payNumber: string }
  | { kind: 'bill'; utilityCode: string; utilityRef: string }

/** Canonical ref for a counterparty — the LimitSubject id and the evidence key. */
export function rampCounterpartyRef(cp: RampCounterparty): string {
  if (cp.kind === 'lipa') return `lipa:${cp.payNumber}`
  if (cp.kind === 'bill') return `bill:${cp.utilityCode}:${cp.utilityRef}`
  return `phone:${cp.phone}`
}

export function parseRampCounterpartyRef(ref: string): RampCounterparty {
  const [kind, ...rest] = ref.split(':')
  if (kind === 'lipa') return { kind: 'lipa', payNumber: rest.join(':') }
  if (kind === 'bill') {
    const [utilityCode, ...r] = rest
    return { kind: 'bill', utilityCode, utilityRef: r.join(':') }
  }
  return { kind: 'phone', phone: rest.join(':') }
}

/**
 * Spellings of the same Tanzanian MSISDN ('0744…', '+255744…', '255744…').
 * Settlement rows store the phone as the partner sent it, so the usage query
 * must match every spelling or one wallet gets a fresh allowance per format.
 */
export function rampPhoneVariants(phone: string): string[] {
  const p = phone.replace(/[\s-]/g, '')
  const out = new Set<string>([p])
  if (p.startsWith('+255')) {
    out.add(p.slice(1))
    out.add(`0${p.slice(4)}`)
  } else if (p.startsWith('255')) {
    out.add(`+${p}`)
    out.add(`0${p.slice(3)}`)
  } else if (p.startsWith('0')) {
    out.add(`+255${p.slice(1)}`)
    out.add(`255${p.slice(1)}`)
  }
  return [...out]
}

/**
 * BoT Parameters #4 & #5 on the RAMP, counted per TANZANIAN-SIDE COUNTERPARTY.
 *
 * ⚠ WHY PER COUNTERPARTY AND NOT PER FLOAT. The parameters cap what one
 * WALLET may do in a period; they are not a platform throughput cap. The first
 * version of this checker aggregated a partner's whole float against a single
 * daily allowance, which turned a per-wallet limit into a per-platform limit —
 * a partner paying two hundred different merchants 50,000 each would have been
 * refused after the fortieth, exactly as if one user had spent 2,000,000.
 * Counting per counterparty keeps the approved per-wallet semantics: no till,
 * bill account or mobile wallet sees more than the daily/30-day allowance
 * through this rail, whichever partner routes it — the key is deliberately NOT
 * scoped to the partner, so two partners cannot stack allowances onto one
 * wallet.
 *
 * What this deliberately does NOT bound is the platform aggregate. The
 * approved parameters do not answer that question for a rail with no end-user,
 * and it is being put to the Bank in writing rather than answered here with an
 * invented number. Per-transaction (#3) still binds on every settlement.
 *
 * Reverted/failed settlements are excluded; usage is the GROSS TZS leg
 * (off-ramp rows store the recipient net with the fee split out, so the fee is
 * added back; on-ramp rows already store the payer's gross). Callers must pass
 * the same gross, or check and accounting drift.
 */
export async function checkRampCounterpartyPeriodLimits(
  cp: RampCounterparty,
  amountTzs: number,
): Promise<LimitError | null> {
  const { db } = getDb()
  const now = new Date()

  const startOfToday = new Date(now)
  startOfToday.setUTCHours(0, 0, 0, 0)

  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30)

  // lipa/bill rows carry the target in `destination`; wallet off-ramps and
  // on-ramps carry only recipient_phone (their destination is null), so the
  // phone match cannot accidentally sweep in lipa/bill rows.
  const counterpartyWhere =
    cp.kind === 'lipa'
      ? sql`${rampSettlements.destination}->>'payNumber' = ${cp.payNumber}`
      : cp.kind === 'bill'
        ? sql`${rampSettlements.destination}->>'utilityCode' = ${cp.utilityCode} and ${rampSettlements.destination}->>'utilityRef' = ${cp.utilityRef}`
        : inArray(rampSettlements.recipientPhone, rampPhoneVariants(cp.phone))

  const noun = cp.kind === 'lipa' ? 'this till' : cp.kind === 'bill' ? 'this bill account' : 'this wallet'

  const sumSince = async (since: Date) => {
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${rampSettlements.tzsAmount} + case when ${rampSettlements.direction} = 'offramp' then ${rampSettlements.feeTzs} else 0 end), 0)`.mapWith(Number),
      })
      .from(rampSettlements)
      .where(
        and(
          counterpartyWhere,
          gte(rampSettlements.createdAt, since),
          notInArray(rampSettlements.status, ['failed', 'reverted']),
        )
      )
    return row?.total ?? 0
  }

  const [dailyUsed, monthlyUsed] = await Promise.all([
    sumSince(startOfToday),
    sumSince(thirtyDaysAgo),
  ])

  if (dailyUsed + amountTzs > SANDBOX_DAILY_USER_CAP_TZS) {
    return {
      code: 'daily_user_cap',
      message: `This transaction would exceed ${noun}'s daily sandbox limit of TZS ${SANDBOX_DAILY_USER_CAP_TZS.toLocaleString()}. Used today: TZS ${dailyUsed.toLocaleString()}.`,
      limit: SANDBOX_DAILY_USER_CAP_TZS,
      requested: amountTzs,
      used: dailyUsed,
    }
  }

  if (monthlyUsed + amountTzs > SANDBOX_MONTHLY_USER_CAP_TZS) {
    return {
      code: 'monthly_user_cap',
      message: `This transaction would exceed ${noun}'s 30-day sandbox limit of TZS ${SANDBOX_MONTHLY_USER_CAP_TZS.toLocaleString()}. Used in last 30 days: TZS ${monthlyUsed.toLocaleString()}.`,
      limit: SANDBOX_MONTHLY_USER_CAP_TZS,
      requested: amountTzs,
      used: monthlyUsed,
    }
  }

  return null
}

/**
 * Period limits for whichever funding source a disbursement uses. Routes should
 * call THIS rather than picking a checker, so a new source cannot ship without
 * a cap.
 */
export async function checkFundingSourcePeriodLimits(
  subject: LimitSubject,
  amountTzs: number,
): Promise<LimitError | null> {
  if (subject.kind === 'ramp_counterparty') {
    return checkRampCounterpartyPeriodLimits(parseRampCounterpartyRef(subject.id), amountTzs)
  }
  return subject.kind === 'sub_wallet'
    ? checkSubWalletPeriodLimits(subject.id, amountTzs)
    : checkUserPeriodLimits(subject.id, amountTzs)
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

// ─────────────────────────────────────────────────────────────────────────────
// Enforcement + evidence
//
// The caps above were always enforced, but nothing recorded a block — so the
// system could assert compliance to the Bank without evidencing it. Routes now
// call ONE function that checks every applicable parameter AND records any
// block, so evidence cannot be forgotten at a call site.
// ─────────────────────────────────────────────────────────────────────────────

export type LimitSubject =
  | { kind: 'user'; id: string }
  | { kind: 'sub_wallet'; id: string }
  /**
   * A Tanzanian-side wallet on the ramp — id is a rampCounterpartyRef()
   * ('lipa:61115582', 'bill:LUKU:24219…', 'phone:0744…'), NOT a uuid.
   */
  | { kind: 'ramp_counterparty'; id: string }

/** Sugar for routes: a counterparty as an enforceable LimitSubject. */
export function rampCounterpartySubject(cp: RampCounterparty): LimitSubject {
  return { kind: 'ramp_counterparty', id: rampCounterpartyRef(cp) }
}

export interface LimitContext {
  /** Route that enforced it, e.g. 'v1/spend'. */
  endpoint: string
  /** 'quote' rejects before money moves; 'execute' rejects at the attempt. */
  stage: 'quote' | 'execute'
  partnerId?: string
}

/**
 * Record a blocked attempt. FAIL-SOFT BY DESIGN: this is evidence, never a
 * decision input, so a write failure must not turn a clean rejection into a
 * 500. A failure is logged loudly because silent non-recording is exactly the
 * gap this table exists to close — if drizzle/0069 is unapplied we want that
 * visible in the logs, not swallowed.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function recordLimitBlock(err: LimitError, subject: LimitSubject, ctx: LimitContext): Promise<void> {
  const row = {
    code: err.code,
    subjectKind: subject.kind,
    // ramp counterparty ids are canonical refs, not uuids — those go in
    // subject_ref (drizzle/0073) so the uuid column stays honest.
    subjectId: UUID_RE.test(subject.id) ? subject.id : null,
    subjectRef: subject.id,
    partnerId: ctx.partnerId ?? null,
    endpoint: ctx.endpoint,
    stage: ctx.stage,
    requestedTzs: err.requested,
    limitTzs: err.limit,
    usedInPeriodTzs: err.used ?? null,
  }
  try {
    const { db } = getDb()
    try {
      await db.insert(sandboxLimitEvents).values(row)
    } catch (e) {
      // Pre-0073 window: better a record without subject_ref than none.
      if (!/subject_ref/i.test(e instanceof Error ? e.message : String(e))) throw e
      const { subjectRef: _dropped, ...legacy } = row
      await db.insert(sandboxLimitEvents).values(legacy)
      console.warn('[sandbox/limits] recorded a limit block WITHOUT subject_ref — apply drizzle/0073.')
    }
  } catch (e) {
    console.error(
      '[sandbox/limits] FAILED to record a limit block — regulatory evidence lost.',
      { code: err.code, endpoint: ctx.endpoint, error: e instanceof Error ? e.message : String(e) }
    )
  }
}

/**
 * Enforce every BoT Testing Parameter applicable to a money movement, and
 * record the block if one bites.
 *
 * Per-transaction (#3) is checked first, then the period caps (#4/#5) counted
 * against the funding source's own subject — a user for a user wallet, the
 * float itself for an agent sub-wallet.
 *
 * Returns the LimitError to hand to limitErrorResponse(), or null to proceed.
 * Routes should call THIS rather than the individual checkers, so that
 * enforcement and evidence can never drift apart.
 */
export async function enforceSandboxLimits(
  subject: LimitSubject,
  amountTzs: number,
  ctx: LimitContext,
): Promise<LimitError | null> {
  const perTxn = checkPerTransactionCap(amountTzs)
  if (perTxn) {
    await recordLimitBlock(perTxn, subject, ctx)
    return perTxn
  }

  const period = await checkFundingSourcePeriodLimits(subject, amountTzs)
  if (period) {
    await recordLimitBlock(period, subject, ctx)
    return period
  }

  return null
}
