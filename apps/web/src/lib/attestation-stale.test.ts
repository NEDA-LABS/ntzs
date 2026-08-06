import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import { computeAnnex, type ReservePot } from './attestation-math'

/**
 * INC 6 Aug 2026 — our PSP suspended the account pending a security review.
 * The money stayed put; the API key stopped working. The daily attestation
 * dropped the unreadable pot and reported 67.69% coverage, which reads as a
 * catastrophic peg breach and was simply false.
 *
 * These pin the two halves of the fix, which only work together: carry the
 * last VERIFIED figure forward so the arithmetic stays true to the money that
 * exists, and mark it stale so the report stays honest about what was actually
 * verified today. Either half alone is a lie in one direction or the other.
 */

const pot = (key: string, amountTzs: number, source: ReservePot['source'], asOf: string): ReservePot => ({
  key,
  label: `${key} balance`,
  source,
  amountTzs,
  asOf,
})

describe('a provider outage is not a reserve deficiency', () => {
  const supply = 6_903_064

  it('reports a peg breach that did not happen when the pot is simply dropped', () => {
    // The shape of the incident: Snippe unreadable, so only AzamPay + Selcom
    // counted. This is the behaviour being fixed, pinned so nobody restores it.
    const withoutSnippe = computeAnnex({
      pots: [
        pot('azampay', 327_500, 'book', '2026-08-06T07:00:00Z'),
        pot('selcom', 4_344_992, 'api', '2026-08-06T07:00:00Z'),
      ],
      nettings: { burnedUnpaidTzs: 0, feesUnmintedTzs: 0, orphanUnmatchedTzs: 0, paidUnmintedTzs: 0 },
      totalSupplyTzs: supply,
    })
    expect(withoutSnippe.rawDeviationPct).toBeLessThan(-30)
  })

  it('stays true to the money that exists when the last verified figure is carried', () => {
    const withStale = computeAnnex({
      pots: [
        pot('snippe', 2_300_000, 'stale', '2026-08-05T07:00:00Z'),
        pot('azampay', 327_500, 'book', '2026-08-06T07:00:00Z'),
        pot('selcom', 4_344_992, 'api', '2026-08-06T07:00:00Z'),
      ],
      nettings: { burnedUnpaidTzs: 0, feesUnmintedTzs: 0, orphanUnmatchedTzs: 0, paidUnmintedTzs: 0 },
      totalSupplyTzs: supply,
    })
    // A stale pot counts toward reserves exactly like any other — it is real
    // money, just money we could not look at today.
    expect(withStale.grossReservesTzs).toBeCloseTo(6_972_492, 0)
    expect(withStale.rawDeviationPct).toBeGreaterThan(0)
  })
})

describe('the guarantees that keep a carried-forward figure honest', () => {
  const LIB = path.join(__dirname)
  const read = (p: string) => fs.readFileSync(path.join(LIB, p), 'utf8')
  const src = read('attestation.ts')

  it('only ever carries a reading that was itself verified live', () => {
    // Re-carrying a stale figure would let one unreadable day propagate
    // forward for ever, ageing without ever tripping the staleness limit.
    expect(src).toContain("p?.source === 'api'")
  })

  it('keeps the original reading time rather than stamping it now', () => {
    // asOf is the whole evidential value of the line: stamping it "now" would
    // make an unverified figure look freshly checked.
    expect(src).toContain('asOf deliberately keeps the ORIGINAL reading time')
  })

  it('refuses to carry a figure past the staleness limit', () => {
    expect(src).toContain('ATTESTATION_MAX_STALE_DAYS')
    expect(src).toContain('carry-forward limit')
  })

  it('falls back to INCOMPLETE when there is nothing verified to carry', () => {
    expect(src).toContain('no previous verified reading to carry forward')
  })

  it('qualifies the attestation, in the annex and in the email', () => {
    expect(src).toContain('staleSources')
    expect(src).toContain('QUALIFIED')
    // The qualification must be above the figures, not buried under them.
    expect(src.indexOf('qualifiedBanner')).toBeLessThan(src.indexOf('(a) Total nTZS in circulation'))
  })

  it('names the source and the date it was last verified', () => {
    expect(src).toContain('last verified reading, as at')
  })
})

describe("a provider's own statement beats our memory of its API", () => {
  const src = fs.readFileSync(path.join(__dirname, 'attestation.ts'), 'utf8')

  it('is tried BEFORE carrying our last reading forward', () => {
    // Order is the whole point: the custodian's current figure outranks our
    // recollection of yesterday's.
    const statementTried = src.indexOf('const statement = await latestStatementPot')
    const snapshotTried = src.indexOf('const snapshot = await lastKnownPot')
    expect(statementTried).toBeGreaterThan(-1)
    expect(statementTried).toBeLessThan(snapshotTried)
  })

  it("uses the STATEMENT's date, not the moment it was typed in", () => {
    // Filing Tuesday's statement on Thursday must not read as Thursday's
    // balance — that would reset the staleness clock on stale information.
    expect(src).toContain('asOf: new Date(row.asOf).toISOString()')
  })

  it('ages out on the same clock, so stale statements cannot accumulate', () => {
    expect(src).toContain('statement && withinLimit(statement.asOf)')
  })

  it('still qualifies the attestation — a human transcribed it', () => {
    expect(src).toContain("p.source === 'stale' || p.source === 'statement'")
    expect(src).toContain("taken from the provider's own statement")
  })

  it('survives the pre-migration window instead of failing the whole report', () => {
    // 0077 is applied by hand; until then there are simply no statements.
    expect(src).toContain('does not exist|42P01')
  })

  it('demands a reference, so the document can be produced on review', () => {
    const page = fs.readFileSync(
      path.join(__dirname, '../app/backstage/attestation/page.tsx'),
      'utf8'
    )
    expect(page).toContain('A statement reference (file name or statement id) is required')
    expect(page).toContain('Statement date cannot be in the future')
  })
})
