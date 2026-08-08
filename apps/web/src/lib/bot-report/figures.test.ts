import fs from 'fs'
import path from 'path'

import { describe, it, expect, vi } from 'vitest'

import { buildReport, hasUnavailableFigures, preFilingWarnings, type Report, type Section } from './figures'

const capturedParams: unknown[] = []

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    sql: (_strings: TemplateStringsArray, ...params: unknown[]) => {
      capturedParams.push(...params)
      return Promise.resolve([])
    },
  }),
}))

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
 * A disclosure and a warning are different things, and conflating them breaks
 * the return in one direction or the other.
 *
 * A warning is unfinished work: the return waits. A disclosure is a position
 * we have decided to report — the verified cohort above the approved cap while
 * relief is sought — and its handling IS the telling. If a disclosure counted
 * as a warning, the return could never be signed while the fact stayed true,
 * and the control would become a nuisance people route around.
 */
describe('a disclosure is reported, not treated as unfinished work', () => {
  const disclosed = () =>
    report([
      section({
        title: 'Parameters',
        figures: [
          {
            label: 'Verified participants (Parameter 2)',
            value: 723,
            provenance: 'approved kyc_cases',
            disclosure: 'The verified cohort stands at 723 against the approved cap of 100.',
          },
        ],
        narrative: 'the cohort is explained here',
      }),
    ])

  it('does not stop the filing', () => {
    expect(preFilingWarnings(disclosed())).toEqual([])
    expect(hasUnavailableFigures(disclosed())).toBe(false)
  })

  it('still stops the filing when the same figure also carries a warning', () => {
    const r = report([
      section({
        title: 'Parameters',
        figures: [
          {
            label: 'Verified participants (Parameter 2)',
            value: 723,
            provenance: 'approved kyc_cases',
            disclosure: 'reported to the Bank',
            warn: 'and something is genuinely unresolved',
          },
        ],
      }),
    ])
    expect(preFilingWarnings(r)).toHaveLength(1)
  })

  it('is carried by the section that explains it', () => {
    // A disclosure with no narrative around it is a number without a position,
    // which is how a supervisor ends up inferring the worst reading.
    const src = fs.readFileSync(path.join(__dirname, 'figures.ts'), 'utf8')
    const at = src.indexOf('disclosure:\n')
    expect(at).toBeGreaterThan(-1)
    expect(src).toContain('We have not narrowed the definition to fit the cap')
    expect(src).toContain('We seek relief on the participant cap')
  })
})

/**
 * The cohort is three populations, and the return must never let one stand for
 * another: the wallet register, the verified cohort, and the hundred selected
 * to demonstrate utility.
 */
describe('the participant figure separates the register from the cohort', () => {
  const src = fs.readFileSync(path.join(__dirname, 'figures.ts'), 'utf8')

  it('counts verified holders, and reports the register total beside it', () => {
    expect(src).toContain('Verified participants (Parameter 2)')
    expect(src).toMatch(/count\(\*\) filter \(\s*\n?\s*where exists \(/)
    expect(src).toContain("kc.status = 'approved'")
    expect(src).toContain('wallet records on the register')
  })

  it('asks for relief only when the cohort has actually outgrown the cap', () => {
    expect(src).toMatch(/if \(!ctx\.verifiedParticipants \|\| ctx\.verifiedParticipants <= SANDBOX_USER_CAP\)/)
    expect(src).toContain('No relief is sought on the participant cap')
  })

  it('quotes the measured cohort in the request rather than a hand-typed number', () => {
    expect(src).toContain('${ctx.verifiedParticipants.toLocaleString()}')
  })
})

/**
 * The defect that put a false confession into the first real export.
 *
 * Partner treasuries and liquidity-provider accounts are written into the same
 * deposit and burn tables as customers, with `role = 'end_user'` because the
 * tables need a user to point at. Parameter 2 filtered on role and the others
 * did not, so a partner topping up its own float by TZS 1,509,046 was reported
 * to the Bank as a participant breaching an approved cap of 1,000,000 — a
 * breach that never happened.
 */
describe('the parameters count participants, not the platform', () => {
  const src = fs.readFileSync(path.join(__dirname, 'figures.ts'), 'utf8')
  const PARTICIPANT = "u.role = 'end_user' and u.neon_auth_user_id !~ '^(treasury|lp)_'"

  it('excludes service accounts from every parameter figure, not just the cohort', () => {
    // One occurrence per parameter query (2, 3 twice, 4 twice, 5 twice) — if a
    // query loses the predicate, the count drops and this fails.
    const uses = src.split(PARTICIPANT).length - 1
    expect(uses, 'a parameter query lost the participant predicate').toBeGreaterThanOrEqual(7)
  })

  it('names both service-account prefixes, since either one would distort a figure', () => {
    for (const prefix of ['treasury', 'lp']) {
      expect(src).toContain(prefix)
    }
    expect(src).toContain('PARTICIPANT_ACCOUNT_SQL')
    expect(src).toContain('SERVICE_ACCOUNT_SQL')
  })

  it('still reports what the service accounts moved, rather than dropping it', () => {
    // Scoping a figure and not reinstating what was scoped out is hiding it.
    expect(src).toContain('Largest platform float movement')
    expect(src).toContain("u.neon_auth_user_id ~ '^(treasury|lp)_'")
  })

  it('says in the return itself that the parameters are participant-scoped', () => {
    expect(src).toContain('Every figure in this section counts participants')
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

/**
 * No Date instance may ever reach the database driver.
 *
 * In production, every figure on the report page failed with `The "string"
 * argument must be of type string … Received an instance of Date`: the
 * deployed bundle and the driver did not share a realm, so the driver's
 * `instanceof Date` check missed our Dates and a raw Date hit the wire
 * encoder. This page was the only code in the app passing Date objects as
 * parameters — everything else passes strings, which behave identically in
 * every realm. This test runs the real buildReport against a capturing stub
 * and fails if any parameter is a Date, so the class of bug cannot return.
 */
describe('query parameters are never Date instances', () => {
  it('buildReport converts the range before any query runs', async () => {
    capturedParams.length = 0
    const report = await buildReport({ from: new Date('2026-06-23T00:00:00Z'), to: new Date() })

    expect(capturedParams.length).toBeGreaterThan(10)
    for (const p of capturedParams) {
      expect(p instanceof Date, `a Date instance reached the driver: ${String(p)}`).toBe(false)
    }

    // The stub returns empty rows everywhere; the report must still be whole.
    // An empty period may honestly mark figures unavailable ("no attestation
    // rows in the period") — but nothing may FAIL: a query error here means a
    // parameter the driver refused.
    expect(report.sections.length).toBe(9)
    for (const s of report.sections) {
      for (const f of s.figures) {
        expect(f.unavailable ?? '', `${s.id} / ${f.label} errored`).not.toContain('query failed')
      }
    }
  })
})

/**
 * Section 5 must name the days, not just count them. The Bank holds one
 * attestation per EAT day, so it can already see any hole in the series — the
 * return has to name each hole and each substituted day before the Bank does.
 */
describe('the attestation calendar is named day by day', () => {
  const src = fs.readFileSync(path.join(__dirname, 'figures.ts'), 'utf8')

  it('lists days with no attestation row, capped at the EAT today', () => {
    expect(src).toContain('generate_series')
    // Without the cap, a period ending in the future reports every
    // not-yet-happened day as a hole. 'now + 3h' is the same EAT calendar-date
    // arithmetic the attestation run itself uses.
    expect(src).toMatch(/least\(\$\{range\.to\}::date, \(now\(\) \+ interval '3 hours'\)::date\)/)
    expect(src).toContain('Days without an attestation')
  })

  it('lists qualified days from the annex each day actually carried', () => {
    // The annex records each reserve pot's source at the moment of attestation;
    // 'statement' and 'stale' are the two substituted kinds. Reading them back
    // is what makes the qualified days listable rather than asserted.
    expect(src).toContain("jsonb_array_elements(annex->'pots')")
    expect(src).toMatch(/p->>'source' in \('stale', 'statement'\)/)
    expect(src).toContain('Days attested on a qualified basis')
  })

  it('warns on both, so neither can be filed unexplained', () => {
    const calendar = src.slice(src.indexOf('Days without an attestation'))
    expect(calendar).toContain('each missing day needs its explanation')
    expect(calendar).toContain('each qualified day should be explained once')
  })
})

/**
 * How incidents were found is diagnostic in itself: a register where nothing is
 * found by automated monitoring is telling us about the monitoring. The return
 * computes the distribution and states the weakness rather than leaving it to
 * be noticed by whoever reads the register later.
 */
describe('the found-by distribution is computed, not asserted', () => {
  const src = fs.readFileSync(path.join(__dirname, 'figures.ts'), 'utf8')

  it('reports incidents grouped by how they were detected, keeping unrecorded visible', () => {
    expect(src).toMatch(/coalesce\(detected_by, 'unrecorded'\)/)
    expect(src).toContain('How incidents were found')
  })

  it('warns when nothing in the period was found by automated monitoring', () => {
    expect(src).toMatch(/foundBy\.some\(\(r\) => r\.by === 'monitoring'\)/)
    expect(src).toContain('nothing in this period was found by automated monitoring')
  })

  it('stays silent when the period has no incidents at all', () => {
    // Zero incidents is not a monitoring failure — the warn must require a
    // non-empty distribution, or an uneventful period files with a false alarm.
    expect(src).toMatch(/foundBy\.length > 0 &&/)
  })
})

/**
 * The return must inform, not alarm: a supervisor should meet the story —
 * what was built, who it serves, in fiat at both ends — before the tables.
 * These pins keep the narrative sections as real drafts rather than letting
 * them regress to "to write" placeholders, and keep the monitoring figure
 * that shows the most active participants re-checked against KYC on every
 * generation.
 */
describe('the return tells the story, not just the numbers', () => {
  const src = fs.readFileSync(path.join(__dirname, 'figures.ts'), 'utf8')

  it('ships draft narratives, not placeholders', () => {
    expect(src).not.toContain('Write last, from the sections below')
    expect(src).not.toContain('Narrative to add before filing')
  })

  it('states the framing and the built capabilities a supervisor must meet first', () => {
    // Fiat at both ends, the token as rails underneath.
    expect(src).toContain('settlement infrastructure')
    expect(src).toMatch(/Shillings at both ends/)
    // The capabilities the pilot added, by name.
    expect(src).toMatch(/Lipa Namba/)
    expect(src).toMatch(/government and utility bills/)
    expect(src).toContain('partner API')
    // The cohort story: pre-sandbox demand, hand-selected within the cap.
    expect(src).toMatch(/three hundred wallets/)
    expect(src).toMatch(/cap of one hundred/)
  })

  it('re-checks the most active participants against KYC on every generation', () => {
    expect(src).toContain('Most active participants: identity coverage')
    expect(src).toMatch(/order by count\(\*\) desc/)
    expect(src).toContain('kyc_cases')
    expect(src).toContain('lack an approved verification case')
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

  it('records closed gaps instead of deleting them', () => {
    // The closure trail: the period anchor and its env var, and the calendar
    // figures section 5 now emits. If someone reverts the generator, this pins
    // the document claim that would then be false.
    expect(doc).toContain('BOT_SANDBOX_COMMENCED_ON')
    expect(doc).toMatch(/no attestation row/i)
    expect(doc).toMatch(/qualified basis/i)
  })

  it('documents the period anchor where the operator will look', () => {
    // The variable only closes the gap if someone sets it — .env.example is
    // where every other operational variable is discovered.
    const env = fs.readFileSync(path.join(__dirname, '../../../../../.env.example'), 'utf8')
    expect(env).toContain('BOT_SANDBOX_COMMENCED_ON=')
  })
})
