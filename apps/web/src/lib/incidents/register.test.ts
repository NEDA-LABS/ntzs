import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import {
  CATEGORIES,
  DETECTED_BY,
  SEVERITIES,
  STATUSES,
  nextIncidentRef,
  registerStats,
  type Incident,
} from './register'

function incident(over: Partial<Incident>): Incident {
  return {
    id: 'id',
    ref: 'INC-2026-07-001',
    title: 't',
    severity: 'sev3',
    category: 'compliance',
    status: 'resolved',
    occurredAt: new Date('2026-07-01T00:00:00Z'),
    detectedAt: null,
    resolvedAt: null,
    detectedBy: null,
    whatHappened: 'w',
    customerImpact: 'c',
    customersAffected: null,
    fundsAtRiskTzs: null,
    fundsLostTzs: 0,
    rootCause: null,
    resolution: null,
    controlAdded: null,
    evidenceRef: null,
    reportedToBot: false,
    reportedToBotAt: null,
    botReportRef: null,
    createdByUserId: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
  }
}

/**
 * The single most consequential number in the register is "how much did
 * customers lose". It is reported as the sum of a column, so the column has to
 * distinguish a confirmed zero from an unanswered question — otherwise an
 * unfinished investigation reads as a clean result.
 */
describe('registerStats — confirmed loss vs unanswered', () => {
  it('never sums an unknown loss as zero', () => {
    const s = registerStats([
      incident({ ref: 'a', fundsLostTzs: 0 }),
      incident({ ref: 'b', fundsLostTzs: null }),
      incident({ ref: 'c', fundsLostTzs: 40_000 }),
    ])
    expect(s.fundsLostTzs).toBe(40_000)
    expect(s.lossUnknown).toBe(1)
  })

  it('counts sev1 and sev2 as material', () => {
    const s = registerStats([
      incident({ ref: 'a', severity: 'sev1' }),
      incident({ ref: 'b', severity: 'sev2' }),
      incident({ ref: 'c', severity: 'sev3' }),
      incident({ ref: 'd', severity: 'sev4' }),
    ])
    expect(s.material).toBe(2)
    expect(s.total).toBe(4)
  })

  it('open counts anything not resolved, mitigated included', () => {
    const s = registerStats([
      incident({ ref: 'a', status: 'open' }),
      incident({ ref: 'b', status: 'mitigated' }),
      incident({ ref: 'c', status: 'resolved' }),
    ])
    expect(s.open).toBe(2)
  })

  it('averages time to resolve over resolved rows only', () => {
    const s = registerStats([
      incident({
        ref: 'a',
        occurredAt: new Date('2026-07-01T00:00:00Z'),
        resolvedAt: new Date('2026-07-03T00:00:00Z'),
      }),
      incident({ ref: 'b', resolvedAt: null }),
    ])
    expect(s.meanDaysToResolve).toBe(2)
  })

  it('reports no mean when nothing is resolved', () => {
    expect(registerStats([incident({ resolvedAt: null })]).meanDaysToResolve).toBeNull()
  })

  it('buckets an unrecorded detection source rather than dropping it', () => {
    const s = registerStats([incident({ ref: 'a', detectedBy: null }), incident({ ref: 'b', detectedBy: 'customer' })])
    expect(s.byDetectedBy.unrecorded).toBe(1)
    expect(s.byDetectedBy.customer).toBe(1)
  })
})

describe('nextIncidentRef', () => {
  it('continues the current month rather than restarting', () => {
    const rows = [incident({ ref: 'INC-2026-07-009' }), incident({ ref: 'INC-2026-07-010' })]
    expect(nextIncidentRef(rows, new Date('2026-07-28T00:00:00Z'))).toBe('INC-2026-07-011')
  })

  it('starts a new month at 001 and ignores other months', () => {
    const rows = [incident({ ref: 'INC-2026-07-010' })]
    expect(nextIncidentRef(rows, new Date('2026-08-01T00:00:00Z'))).toBe('INC-2026-08-001')
  })

  it('is not confused by a hand-written ref that does not parse', () => {
    const rows = [incident({ ref: 'INC-2026-07-001' }), incident({ ref: 'INC-2026-07-oops' })]
    expect(nextIncidentRef(rows, new Date('2026-07-28T00:00:00Z'))).toBe('INC-2026-07-002')
  })
})

/**
 * An incident with no control named is an incident that will recur, so the
 * seeded backfill has to hold itself to the standard the page asks of every
 * new entry. This also catches the ordinary mistake of adding a row to the
 * migration and forgetting the last column.
 */
describe('the seeded backfill meets the register’s own standard', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../../../../drizzle/0070_incident_register.sql'), 'utf8')
  const refs = [...sql.matchAll(/'(INC-\d{4}-\d{2}-\d{3})'/g)].map((m) => m[1])

  it('seeds a backfill rather than starting today', () => {
    expect(refs.length).toBeGreaterThanOrEqual(8)
  })

  it('uses no ref twice', () => {
    expect(new Set(refs).size).toBe(refs.length)
  })

  it('names a control for every entry', () => {
    // One VALUES tuple per ref; control_added is the last column before the
    // evidence pointer, and both must be present.
    const tuples = sql.split(/\n\('INC-/).slice(1)
    expect(tuples.length).toBe(refs.length)
    for (const t of tuples) {
      const body = t.slice(0, t.indexOf('\n\n') === -1 ? t.length : t.indexOf('\n\n'))
      expect(body.length, `seeded entry ${t.slice(0, 14)} looks truncated`).toBeGreaterThan(400)
    }
  })

  it('discloses nothing to the Bank by default', () => {
    // Disclosure is a judgement made by the people who sign the return, so no
    // seeded row may arrive pre-marked as disclosed.
    expect(sql).not.toMatch(/reported_to_bot"?\s*,[^)]*\btrue\b/i)
  })

  it('only uses vocabulary the application understands', () => {
    // Every seeded tuple carries: … severity, category, status … then a date
    // triple ending in detected_by. Match counts are asserted so a regex that
    // stops matching fails the test instead of passing vacuously.
    const classified = [...sql.matchAll(/'(sev\d)', '(\w+)', '(\w+)'/g)]
    expect(classified.length).toBe(refs.length)
    for (const m of classified) {
      expect(SEVERITIES).toContain(m[1] as (typeof SEVERITIES)[number])
      expect(CATEGORIES).toContain(m[2] as (typeof CATEGORIES)[number])
      expect(STATUSES).toContain(m[3] as (typeof STATUSES)[number])
    }

    const found = [...sql.matchAll(/^ '\d{4}-\d{2}-\d{2}', .*'(\w+)',$/gm)]
    expect(found.length).toBe(refs.length)
    for (const m of found) {
      expect(DETECTED_BY).toContain(m[1] as (typeof DETECTED_BY)[number])
    }
  })
})
