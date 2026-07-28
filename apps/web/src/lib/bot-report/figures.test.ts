import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import { hasUnavailableFigures, preFilingWarnings, type Report, type Section } from './figures'

function section(over: Partial<Section>): Section {
  return { id: 's', title: 'Section', question: 'q', figures: [], ...over }
}

function report(sections: Section[]): Report {
  return { range: { from: new Date('2026-07-01'), to: new Date('2026-07-31') }, sections, generatedAt: new Date() }
}

/**
 * The rule the whole generator exists to enforce: a number that could not be
 * computed is never presented as zero. Zero is a claim about the world; a
 * failed query is a claim about our plumbing, and a document the Bank relies on
 * must not confuse them.
 */
describe('an uncomputable figure is never a zero', () => {
  it('surfaces unavailable figures instead of letting them pass', () => {
    const r = report([
      section({
        title: 'Incidents',
        figures: [
          { label: 'Customer funds lost', value: null, provenance: 'not computed', unavailable: 'table missing' },
        ],
      }),
    ])
    expect(hasUnavailableFigures(r)).toBe(true)
    expect(preFilingWarnings(r)).toEqual([
      { section: 'Incidents', label: 'Customer funds lost', note: 'table missing' },
    ])
  })

  it('reports a clean run as clean', () => {
    const r = report([
      section({ figures: [{ label: 'Days attested', value: 31, provenance: 'count(attestations)' }] }),
    ])
    expect(hasUnavailableFigures(r)).toBe(false)
    expect(preFilingWarnings(r)).toEqual([])
  })
})

/**
 * A breach of an approved parameter must stop the return at the top of the
 * page, not sit inside a table waiting to be noticed by the person transcribing
 * it.
 */
describe('pre-filing warnings', () => {
  it('raises a figure that breached an approved parameter', () => {
    const r = report([
      section({
        title: 'Parameters',
        figures: [
          {
            label: 'Largest single transaction (Parameter 3)',
            value: 1_400_000,
            provenance: 'max(amount_tzs)',
            warn: 'a transaction exceeded the per-transaction cap — establish how before filing',
          },
        ],
      }),
    ])
    expect(preFilingWarnings(r)).toHaveLength(1)
    expect(preFilingWarnings(r)[0].label).toContain('Parameter 3')
  })

  it('raises an unestablished loss figure rather than filing it as a clean zero', () => {
    const r = report([
      section({
        title: 'Incidents',
        figures: [
          {
            label: 'Customer funds lost',
            value: 0,
            provenance: 'sum(funds_lost_tzs)',
            warn: '2 incident(s) have no established figure — establish them before filing, do not file this as a clean zero',
          },
        ],
      }),
    ])
    expect(preFilingWarnings(r)).toHaveLength(1)
  })

  /**
   * Severity is an explicit field, never inferred from the wording of a note.
   * These are the real strings the generator emits — an earlier version matched
   * prose and warned on this one, because "whether or not they transacted"
   * contains the word "not". A banner that cries wolf is one people learn to
   * click past, which is worse than no banner.
   */
  it('leaves ordinary explanatory notes alone, however they are worded', () => {
    const r = report([
      section({
        figures: [
          {
            label: 'Participants transacting',
            value: 12,
            provenance: 'distinct user_id',
            note: 'Distinct from the Parameter 2 cohort, which counts everyone holding a wallet whether or not they transacted.',
          },
          {
            label: 'Identities verified',
            value: 40,
            provenance: 'kyc_cases reaching approved',
            note: 'Verification is a structural prerequisite for issuing a wallet — an unverified person cannot hold nTZS.',
          },
        ],
      }),
    ])
    expect(preFilingWarnings(r)).toEqual([])
  })
})

/**
 * The notes the generator actually ships have to survive the warning rule —
 * this asserts against the real source rather than a fixture, which is the gap
 * that let the prose-matching bug through in the first place.
 */
describe('shipped notes do not accidentally trip the warning rule', () => {
  const src = fs.readFileSync(path.join(__dirname, 'figures.ts'), 'utf8')

  it('classifies severity by field, not by wording', () => {
    expect(src).toContain('warn?: string')
    // No regex over prose anywhere in the warning path.
    expect(src).not.toMatch(/test\(f\.note\)/)
  })

  it('emits at least one real warning path per computed section', () => {
    // Parameters, incidents and reserve each have a condition that must stop a
    // filing; if one loses its warn field the return goes out looking clean.
    expect((src.match(/^\s+warn:/gm) ?? []).length).toBeGreaterThanOrEqual(5)
  })
})

/**
 * Provenance is not decoration — it is what makes a figure re-derivable by
 * whoever signs the return, and what keeps the next period's definitions
 * identical to this one. A figure without it should not compile past review.
 */
describe('every figure the generator can emit carries a derivation', () => {
  const src = fs.readFileSync(path.join(__dirname, 'figures.ts'), 'utf8')

  it('constructs no figure literal without a provenance', () => {
    // Structural rather than a count: every object literal that names a figure
    // must carry its derivation, and the omission this catches is the ordinary
    // one — adding a figure and forgetting where it came from.
    const literals = src.split(/^\s+label: (?=['"`])/m).slice(1)
    expect(literals.length).toBeGreaterThan(15)
    for (const body of literals) {
      const objectBody = body.slice(0, body.indexOf('\n        },') + 1 || 600)
      expect(objectBody, `a figure literal starting "${body.slice(0, 50)}" has no provenance`).toContain('provenance:')
    }
  })

  it('degrades a failed section into unavailable figures rather than empty ones', () => {
    expect(src).toContain('async function safe(')
    expect(src).toContain('isMissingSchemaObject')
    expect(src).toMatch(/unavailable: reason/)
  })

  it('reads the peg from the attestation series rather than recomputing it', () => {
    // Recomputing could disagree with the daily submissions the Bank already
    // holds, and that discrepancy would be indefensible.
    expect(src).toContain('from attestations')
    expect(src).not.toMatch(/reserve_total\s*[-+*/]\s*ntzs_circulation/)
  })

  it('counts the daily cap the same way enforcement does', () => {
    // Deposits and burns together, per user per day — if the report and the
    // live cap disagreed about what counts, one of them would be lying.
    const at = src.indexOf('const [largestDay]')
    expect(at).toBeGreaterThan(-1)
    const query = src.slice(at, src.indexOf('const [largestMonth]'))
    expect(query).toContain('deposit_requests')
    expect(query).toContain('burn_requests')
    expect(query).toContain('union all')
    expect(query).toContain("date_trunc('day', created_at)")
  })
})

describe('the architecture document stays in step with the generator', () => {
  // Prose is line-wrapped, so assertions are made against the unwrapped text —
  // the claim is about what the document says, not how it is laid out.
  const doc = fs
    .readFileSync(path.join(__dirname, '../../../../../docs/bot/milestone-report-architecture.md'), 'utf8')
    .replace(/\s+/g, ' ')

  it('describes all eight sections', () => {
    for (const heading of [
      'Executive summary',
      'Compliance with the approved testing parameters',
      'Incidents, shortcomings and errors',
      'Operational statistics',
      'Reserve management and the peg',
      'Onboarding and consumer protection',
      'What the pilot established about the market',
      'Variations sought',
    ]) {
      expect(doc, `architecture doc is missing "${heading}"`).toContain(heading)
    }
  })

  it('states the gaps rather than leaving them implicit', () => {
    expect(doc).toContain('Known gaps to close before filing')
    // The two that are easiest to quietly omit.
    expect(doc).toMatch(/twelve June deposits/i)
    expect(doc).toMatch(/ring-fenced trust account/i)
  })
})
