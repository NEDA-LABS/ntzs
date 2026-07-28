import { desc } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { isMissingSchemaObject } from '@/lib/db-errors'
import { incidents } from '@ntzs/db'

/**
 * The incident register — read model and vocabulary.
 *
 * The table is described in drizzle/0070. What lives here is everything that
 * has to agree between the Backstage page and, later, the periodic return to
 * the Bank: the closed vocabularies, the summary arithmetic, and a read that
 * degrades instead of 500-ing when the migration has not been applied yet.
 */

export const SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const
export type Severity = (typeof SEVERITIES)[number]

/**
 * Severity is about what actually happened, not how loud it felt at the time.
 * The dividing line between sev2 and sev3 is whether a customer-facing or
 * money-moving path behaved wrongly, or only the evidence around it was thin.
 */
export const SEVERITY_LABELS: Record<Severity, string> = {
  sev1: 'Funds lost or service down',
  sev2: 'Money, authorisation or compliance defect reached production',
  sev3: 'Control or evidence gap, no customer impact',
  sev4: 'Internal-only degradation',
}

export const CATEGORIES = ['money', 'availability', 'compliance', 'security', 'data'] as const
export type Category = (typeof CATEGORIES)[number]

export const STATUSES = ['open', 'mitigated', 'resolved'] as const
export type Status = (typeof STATUSES)[number]

/**
 * How it was found. Tracked on its own because the distribution is diagnostic:
 * a register where nothing is ever found by `monitoring` is telling you the
 * monitoring is not working, and one where `customer` dominates is telling you
 * the customers are the monitoring.
 */
export const DETECTED_BY = [
  'monitoring',
  'log_review',
  'customer',
  'partner',
  'internal_review',
  'regulator',
] as const
export type DetectedBy = (typeof DETECTED_BY)[number]

export const DETECTED_BY_LABELS: Record<DetectedBy, string> = {
  monitoring: 'Automated monitoring',
  log_review: 'Log review by hand',
  customer: 'Reported by a customer',
  partner: 'Reported by a partner',
  internal_review: 'Internal review',
  regulator: 'Raised by the regulator',
}

export type Incident = typeof incidents.$inferSelect

export interface RegisterRead {
  rows: Incident[]
  /** True when drizzle/0070 has not been applied yet — the page says so rather than breaking. */
  schemaPending: boolean
}

/**
 * Whole register, newest first.
 *
 * Deliberately unpaginated: a register that needs paging is one nobody reads
 * end to end, and reading it end to end is the point. Revisit if it passes a
 * few hundred rows.
 */
export async function listIncidents(): Promise<RegisterRead> {
  try {
    const { db } = getDb()
    const rows = await db.select().from(incidents).orderBy(desc(incidents.occurredAt))
    return { rows, schemaPending: false }
  } catch (err) {
    // Migrations are applied by hand, so the code can be live before its table
    // is. That is a banner, not a 500.
    if (isMissingSchemaObject(err)) return { rows: [], schemaPending: true }
    throw err
  }
}

export interface RegisterStats {
  total: number
  open: number
  /** sev1 + sev2 — the ones a supervisor will ask about by name. */
  material: number
  /**
   * Confirmed loss. Rows where the answer is unknown are excluded and counted
   * in `lossUnknown` instead, so this number can never quietly absorb a NULL.
   */
  fundsLostTzs: number
  lossUnknown: number
  reportedToBot: number
  byCategory: Record<Category, number>
  byDetectedBy: Record<string, number>
  /** Mean days from occurrence to resolution, over resolved rows only. */
  meanDaysToResolve: number | null
}

export function registerStats(rows: Incident[]): RegisterStats {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
  const byDetectedBy: Record<string, number> = {}

  let fundsLostTzs = 0
  let lossUnknown = 0
  let resolvedSpanDays = 0
  let resolvedCount = 0

  for (const r of rows) {
    if (r.category in byCategory) byCategory[r.category as Category] += 1
    const found = r.detectedBy ?? 'unrecorded'
    byDetectedBy[found] = (byDetectedBy[found] ?? 0) + 1

    // NULL is "we have not answered this yet", which is a different statement
    // from zero and must not be summed as one.
    if (r.fundsLostTzs == null) lossUnknown += 1
    else fundsLostTzs += r.fundsLostTzs

    if (r.resolvedAt) {
      resolvedSpanDays += (r.resolvedAt.getTime() - r.occurredAt.getTime()) / 86_400_000
      resolvedCount += 1
    }
  }

  return {
    total: rows.length,
    open: rows.filter((r) => r.status !== 'resolved').length,
    material: rows.filter((r) => r.severity === 'sev1' || r.severity === 'sev2').length,
    fundsLostTzs,
    lossUnknown,
    reportedToBot: rows.filter((r) => r.reportedToBot).length,
    byCategory,
    byDetectedBy,
    meanDaysToResolve: resolvedCount ? resolvedSpanDays / resolvedCount : null,
  }
}

/**
 * Next reference in the INC-YYYY-MM-NNN series.
 *
 * The sequence is per month and derived from what is already in the register,
 * so a hand-written entry and a seeded one cannot collide. Uniqueness is
 * ultimately the database's job — `ref` is UNIQUE — this only picks a sensible
 * default for the form.
 */
export function nextIncidentRef(rows: Incident[], now: Date): string {
  const prefix = `INC-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-`
  const highest = rows
    .filter((r) => r.ref.startsWith(prefix))
    .map((r) => Number(r.ref.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((max, n) => Math.max(max, n), 0)
  return `${prefix}${String(highest + 1).padStart(3, '0')}`
}
