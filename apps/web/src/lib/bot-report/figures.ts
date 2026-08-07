import { getDb } from '@/lib/db'
import { isMissingSchemaObject } from '@/lib/db-errors'
import { loadHoldersView, verifiedNamedHolders } from '@/lib/holders'
import {
  SANDBOX_USER_CAP,
  SANDBOX_PER_TXN_CAP_TZS,
  SANDBOX_DAILY_USER_CAP_TZS,
  SANDBOX_MONTHLY_USER_CAP_TZS,
} from '@/lib/sandbox/limits'

/**
 * Figures for the periodic return to the Bank of Tanzania.
 *
 * The architecture is in docs/bot/milestone-report-architecture.md. What lives
 * here is the part that must not be done by hand: the numbers.
 *
 * Two rules, and they are the whole design.
 *
 * 1. EVERY FIGURE CARRIES ITS PROVENANCE. A number in a supervisory return
 *    should be re-derivable by whoever signs it, and by whoever audits it
 *    later. Each figure ships with the query shape that produced it, and the
 *    page prints it underneath. This is also what makes the next return
 *    consistent with this one — the definition travels with the number instead
 *    of living in someone's head.
 *
 * 2. A FIGURE THAT CANNOT BE COMPUTED IS NEVER ZERO. It renders as
 *    "unavailable" with the reason. Zero is a claim about the world; a failed
 *    query is a claim about our plumbing, and the two must never be confused
 *    in a document the Bank relies on. This is the same rule the incident
 *    register applies to funds-lost.
 */

export interface Figure {
  label: string
  /** null only when `unavailable` is set — never a stand-in for zero. */
  value: string | number | null
  unit?: string
  /** How this number was derived, printed under it in the report. */
  provenance: string
  /** Set when the figure could not be computed. Renders instead of a value. */
  unavailable?: string
  /** Optional plain-language reading of what the number means. */
  note?: string
  /**
   * Something that must be dealt with before this is filed — a breached
   * parameter, an unestablished figure, a gap in the series.
   *
   * Deliberately its own field rather than something inferred from the wording
   * of `note`. Pattern-matching prose for severity is how you end up warning on
   * the phrase "whether or not they transacted", and a warning banner that
   * cries wolf is one people learn to click past.
   */
  warn?: string
  /**
   * A fact the return states to the Bank in its own body — as distinct from
   * `warn`, which is an instruction to us.
   *
   * The difference decides whether the document can be signed. A figure that
   * could not be computed, or a loss that has not been established, is unfinished
   * work: the return waits. A known position we have decided to report — the
   * verified cohort standing above the approved cap while relief is sought — is
   * finished work whose handling *is* the telling. Marking it as a warning would
   * mean the return could never be signed while the fact remained true, which
   * turns the control into a nuisance people learn to route around.
   *
   * A disclosure is only honest if the section around it explains the position.
   * Never set one without the narrative that carries it.
   */
  disclosure?: string
}

/** A tabulated exhibit — a register or breakdown that is a list, not a figure. */
export interface SectionTable {
  columns: Array<{ header: string; weight: number; align?: 'left' | 'right' }>
  rows: Array<Array<{ text: string; sub?: string }>>
  /** Printed under the table: scope, cut-off, and what was left out. */
  caption?: string
}

export interface Section {
  id: string
  title: string
  /** The supervisory question this section answers. */
  question: string
  figures: Figure[]
  /** Sections that are narrative rather than computed say so here. */
  narrative?: string
  /** Optional exhibit rendered under the figures, on screen and in the PDF. */
  table?: SectionTable
}

export interface DateRange {
  from: Date
  to: Date
}

/**
 * The range as it is allowed to touch the database: ISO strings, never Date
 * instances.
 *
 * In production the report page was the only code in the app passing raw Date
 * objects as query parameters, and every one of its queries failed with
 * `The "string" argument must be of type string … Received an instance of
 * Date` — an instanceof check missing the value because the deployed bundle
 * and the driver do not share a realm. Strings behave identically in every
 * realm and every driver wrapper, which is why the rest of the app (which
 * passes strings) never hit this. All section queries therefore take this
 * type, and `buildReport` converts exactly once at the boundary.
 */
interface QueryRange {
  from: string
  to: string
}

const toQueryRange = (range: DateRange): QueryRange => ({
  from: range.from.toISOString(),
  to: range.to.toISOString(),
})

/**
 * Run a query that produces figures, and convert any failure into figures
 * marked unavailable rather than letting the section vanish or read as zero.
 * A missing table (migration not applied) is reported differently from a
 * genuine error, because they call for different actions.
 */
async function safe(labels: string[], fn: () => Promise<Figure[]>): Promise<Figure[]> {
  try {
    return await fn()
  } catch (err) {
    // The page shows a one-line reason; the function log keeps the stack. The
    // realm bug that once broke every figure on this page was diagnosable only
    // from its message — never make the next one that expensive.
    console.error('[bot-report] figures failed:', labels.join(' / '), err)
    const reason = isMissingSchemaObject(err)
      ? 'the table this reads has not been created in this database yet'
      : `query failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`
    return labels.map((label) => ({
      label,
      value: null,
      provenance: 'not computed',
      unavailable: reason,
    }))
  }
}

const num = (v: unknown): number => (v == null ? 0 : Number(v))

/**
 * Section 2 — compliance with the approved testing parameters.
 *
 * The section a supervisor reads first, and the one where the useful answer is
 * not "we set a limit" but "here is it binding". Each parameter reports the
 * limit, the largest value actually observed against it, and the number of
 * attempts it refused — the last of which only exists because every enforcement
 * point records its blocks (drizzle/0069).
 */
async function parameterSection(range: QueryRange): Promise<Section> {
  const { sql } = getDb()

  const figures = await safe(
    ['Verified participants (Parameter 2)', 'Largest single transaction (Parameter 3)', 'Largest participant day (Parameter 4)', 'Largest participant 30-day total (Parameter 5)'],
    async () => {
      // The register and the cohort are different populations, and reporting
      // only the first is what makes a dormant pre-commencement wallet look
      // like a sandbox participant. Both are counted in one pass so they
      // cannot drift apart.
      const [participants] = await sql<{ registered: string; verified: string }[]>`
        select
          count(*)::text as registered,
          count(*) filter (
            where exists (
              select 1 from kyc_cases kc
              where kc.user_id = t.user_id and kc.status = 'approved'
            )
          )::text as verified
        from (
          select distinct w.user_id
          from wallets w
          join users u on u.id = w.user_id
          where u.role = 'end_user' and w.created_at <= ${range.to}
        ) t
      `

      const [largestTxn] = await sql<{ n: string | null }[]>`
        select greatest(
          coalesce((select max(amount_tzs) from deposit_requests
                    where created_at between ${range.from} and ${range.to}
                      and status not in ('rejected','cancelled','kyc_rejected')), 0),
          coalesce((select max(amount_tzs) from burn_requests
                    where created_at between ${range.from} and ${range.to}
                      and status not in ('rejected','failed')), 0)
        )::text as n
      `

      // Per participant per UTC day, deposits and burns together — the same
      // arithmetic the live enforcement uses, so the reported maximum and the
      // enforced cap cannot disagree.
      const [largestDay] = await sql<{ n: string | null }[]>`
        with movements as (
          select user_id, created_at, amount_tzs from deposit_requests
            where created_at between ${range.from} and ${range.to}
              and status not in ('rejected','cancelled','kyc_rejected','mint_failed')
          union all
          select user_id, created_at, amount_tzs from burn_requests
            where created_at between ${range.from} and ${range.to}
              and status not in ('rejected','failed')
        )
        select coalesce(max(total), 0)::text as n from (
          select user_id, date_trunc('day', created_at) as d, sum(amount_tzs) as total
          from movements group by 1, 2
        ) per_day
      `

      const [largestMonth] = await sql<{ n: string | null }[]>`
        with movements as (
          select user_id, amount_tzs from deposit_requests
            where created_at between ${range.from} and ${range.to}
              and status not in ('rejected','cancelled','kyc_rejected','mint_failed')
          union all
          select user_id, amount_tzs from burn_requests
            where created_at between ${range.from} and ${range.to}
              and status not in ('rejected','failed')
        )
        select coalesce(max(total), 0)::text as n from (
          select user_id, sum(amount_tzs) as total from movements group by 1
        ) per_user
      `

      const registeredCount = num(participants?.registered)
      const participantCount = num(participants?.verified)
      const maxTxn = num(largestTxn?.n)
      const maxDay = num(largestDay?.n)
      const maxPeriod = num(largestMonth?.n)

      return [
        {
          label: 'Verified participants (Parameter 2)',
          value: participantCount,
          unit: `of ${SANDBOX_USER_CAP} permitted · ${registeredCount.toLocaleString()} wallet records on the register`,
          provenance:
            'holders of a wallet created on or before the period end, whose role is end_user and who hold an approved identity-verification case; the register total counts the same wallets without the verification test',
          note:
            'Includes merchants: a collection mints nTZS to the merchant, so they hold the token and are counted. ' +
            'The register total is larger because wallets issued before this sandbox commenced remain on it; those ' +
            'holders are not part of the tested cohort until they verify under the standard now in force.',
          disclosure:
            participantCount > SANDBOX_USER_CAP
              ? `The verified cohort stands at ${participantCount.toLocaleString()} against the approved cap of ${SANDBOX_USER_CAP}. ` +
                'This is reported in full, explained in this section, and a variation is sought in the final section of this return.'
              : undefined,
        },
        {
          label: 'Largest single transaction (Parameter 3)',
          value: maxTxn,
          unit: `TZS · cap ${SANDBOX_PER_TXN_CAP_TZS.toLocaleString()}`,
          provenance: 'max(amount_tzs) across deposit_requests and burn_requests in the period, excluding terminal failures',
          warn: maxTxn > SANDBOX_PER_TXN_CAP_TZS ? 'a transaction exceeded the per-transaction cap — establish how before filing' : undefined,
        },
        {
          label: 'Largest participant day (Parameter 4)',
          value: maxDay,
          unit: `TZS · cap ${SANDBOX_DAILY_USER_CAP_TZS.toLocaleString()}`,
          provenance: 'deposits and burns summed per user per UTC day — the same arithmetic the live enforcement applies',
          warn: maxDay > SANDBOX_DAILY_USER_CAP_TZS ? 'a participant exceeded the daily cap — establish how before filing' : undefined,
        },
        {
          label: 'Largest participant total for the period (Parameter 5)',
          value: maxPeriod,
          unit: `TZS · 30-day cap ${SANDBOX_MONTHLY_USER_CAP_TZS.toLocaleString()}`,
          provenance: 'deposits and burns summed per user across the whole period; compare to the cap only where the period is 30 days or shorter',
        },
      ]
    }
  )

  // Blocks are the evidence the caps bind. They only exist from drizzle/0069
  // onward, so the figure states that rather than implying a clean history.
  const blocks = await safe(['Transactions refused by a testing parameter'], async () => {
    const rows = await sql<{ code: string; n: string }[]>`
      select code, count(*)::text as n
      from sandbox_limit_events
      where occurred_at between ${range.from} and ${range.to}
      group by code order by code
    `
    const total = rows.reduce((sum, r) => sum + num(r.n), 0)
    const breakdown = rows.length ? rows.map((r) => `${r.code}: ${r.n}`).join(' · ') : 'none recorded'
    return [
      {
        label: 'Transactions refused by a testing parameter',
        value: total,
        unit: breakdown,
        provenance: 'count of sandbox_limit_events in the period, grouped by parameter',
        note:
          total === 0
            ? 'No participant reached a limit in this period. Recording began when the evidence table was introduced — see the incident register.'
            : undefined,
      },
    ]
  })

  return {
    id: 'parameters',
    title: 'Compliance with the approved testing parameters',
    question: 'Are the limits the Bank approved actually binding, and can you show one binding?',
    figures: [...figures, ...blocks],
    narrative:
      'On the size of the cohort, we report the position plainly. Three populations must be distinguished, and ' +
      'conflating them is what would make this figure unreadable. The first is the wallet register: every wallet ' +
      'ever issued on the platform, including those created before this sandbox commenced. The second is the ' +
      'verified cohort: holders who have completed identity verification to the standard now in force, against the ' +
      'National Identification Authority registry or through a partner we rely upon under a signed agreement. The ' +
      'third is the demonstration group: one hundred participants we are selecting from within the verified cohort ' +
      'to exercise the utility this pilot exists to test — merchant payment, bill payment and deposit on every ' +
      'network — and whose activity is the evidence the next return will carry. The verified cohort exceeds one ' +
      'hundred. We have not narrowed the definition to fit the cap, and we are not treating the excess as ' +
      'immaterial: it is stated here, the composition is set out in the holders section below, and a variation is ' +
      'sought in the final section. Holders who have not verified under the current standard are dormant on the ' +
      'register rather than active in the pilot, and the holders section reports how many of them hold any balance ' +
      'at all.',
  }
}

/**
 * Section 3 — incidents, shortcomings and errors.
 *
 * Reported from the register rather than written fresh, so the return cannot
 * quietly contain a shorter list than the internal record.
 */
async function incidentSection(range: QueryRange): Promise<Section> {
  const { sql } = getDb()

  const figures = await safe(
    ['Incidents recorded', 'Material incidents', 'Customer funds lost', 'Still open at period end', 'How incidents were found'],
    async () => {
      const [row] = await sql<
        { total: string; material: string; lost: string; unknown_loss: string; open: string; mean_days: string | null }[]
      >`
        select
          count(*)::text as total,
          count(*) filter (where severity in ('sev1','sev2'))::text as material,
          coalesce(sum(funds_lost_tzs), 0)::text as lost,
          count(*) filter (where funds_lost_tzs is null)::text as unknown_loss,
          count(*) filter (where status <> 'resolved')::text as open,
          avg(extract(epoch from (resolved_at - occurred_at)) / 86400)::text as mean_days
        from incidents
        where occurred_at between ${range.from} and ${range.to}
      `

      const foundBy = await sql<{ by: string; n: string }[]>`
        select coalesce(detected_by, 'unrecorded') as by, count(*)::text as n
        from incidents
        where occurred_at between ${range.from} and ${range.to}
        group by 1 order by 2 desc, 1
      `

      const unknownLoss = num(row?.unknown_loss)
      return [
        {
          label: 'Incidents recorded',
          value: num(row?.total),
          provenance: 'count of incidents with occurred_at in the period',
        },
        {
          label: 'Material incidents (Sev 1–2)',
          value: num(row?.material),
          provenance: 'incidents where severity is sev1 or sev2 — the ones reported individually',
        },
        {
          label: 'Customer funds lost',
          value: num(row?.lost),
          unit: 'TZS',
          provenance: 'sum of funds_lost_tzs over incidents in the period; entries where the answer is not established are excluded, not counted as zero',
          warn:
            unknownLoss > 0
              ? `${unknownLoss} incident(s) have no established figure — establish them before filing, do not file this as a clean zero`
              : undefined,
        },
        {
          label: 'Still open at period end',
          value: num(row?.open),
          unit: row?.mean_days ? `mean ${Number(row.mean_days).toFixed(1)} days to resolve` : undefined,
          provenance: 'incidents whose status is not resolved; mean time to resolve is over resolved entries only',
        },
        {
          // The distribution is diagnostic in itself: a register where nothing
          // is found by monitoring is telling us about the monitoring, and the
          // return says so rather than leaving it to be noticed.
          label: 'How incidents were found',
          value: foundBy.length ? foundBy.map((r) => `${r.by} ${r.n}`).join(' · ') : 'none in period',
          provenance: 'count of incidents per detected_by value',
          warn:
            foundBy.length > 0 && !foundBy.some((r) => r.by === 'monitoring')
              ? 'nothing in this period was found by automated monitoring — report it as a known weakness with the work planned against it, not silence'
              : undefined,
        },
      ]
    }
  )

  return {
    id: 'incidents',
    title: 'Incidents, shortcomings and errors',
    question: 'What went wrong, who was affected, and what changed because of it?',
    figures,
    narrative:
      'Each material incident is reported individually with its root cause and the control added, taken verbatim from the register at /backstage/incidents. The register is the complete internal record; this section is the subset disclosed, and the register itself records which entries have been disclosed and in which return.',
  }
}

/**
 * Section 4 — operational statistics.
 *
 * Volume, participants and the rails underneath. Success rate is reported per
 * rail because "the platform worked" is not a useful claim when four providers
 * sit behind it and they do not fail together.
 */
async function operationsSection(range: QueryRange): Promise<Section> {
  const { sql } = getDb()

  const figures = await safe(
    ['nTZS issued', 'nTZS redeemed', 'Issuance transactions', 'Redemption transactions', 'Participants transacting'],
    async () => {
      const [dep] = await sql<{ n: string; vol: string; ok: string }[]>`
        select count(*)::text as n,
               coalesce(sum(amount_tzs) filter (where status = 'minted'), 0)::text as vol,
               count(*) filter (where status = 'minted')::text as ok
        from deposit_requests
        where created_at between ${range.from} and ${range.to}
      `
      const [brn] = await sql<{ n: string; vol: string; ok: string }[]>`
        select count(*)::text as n,
               coalesce(sum(amount_tzs) filter (where status = 'burned'), 0)::text as vol,
               count(*) filter (where status = 'burned')::text as ok
        from burn_requests
        where created_at between ${range.from} and ${range.to}
      `
      const [active] = await sql<{ n: string }[]>`
        select count(distinct user_id)::text as n from (
          select user_id from deposit_requests where created_at between ${range.from} and ${range.to}
          union
          select user_id from burn_requests where created_at between ${range.from} and ${range.to}
        ) t
      `

      const depTotal = num(dep?.n)
      const brnTotal = num(brn?.n)
      const pct = (ok: number, total: number) => (total ? `${((ok / total) * 100).toFixed(1)}% completed` : 'no attempts')

      return [
        {
          label: 'nTZS issued',
          value: num(dep?.vol),
          unit: 'TZS',
          provenance: 'sum of amount_tzs over deposit_requests reaching status = minted in the period',
        },
        {
          label: 'nTZS redeemed',
          value: num(brn?.vol),
          unit: 'TZS',
          provenance: 'sum of amount_tzs over burn_requests reaching status = burned in the period',
        },
        {
          label: 'Issuance transactions',
          value: depTotal,
          unit: pct(num(dep?.ok), depTotal),
          provenance: 'all deposit_requests created in the period; completion counts those that reached minted',
        },
        {
          label: 'Redemption transactions',
          value: brnTotal,
          unit: pct(num(brn?.ok), brnTotal),
          provenance: 'all burn_requests created in the period; completion counts those that reached burned',
        },
        {
          label: 'Participants transacting',
          value: num(active?.n),
          provenance: 'distinct user_id appearing on a deposit or burn in the period',
          note: 'Distinct from the Parameter 2 cohort, which counts everyone holding a wallet whether or not they transacted.',
        },
      ]
    }
  )

  const rails = await safe(['Issuance by rail'], async () => {
    const rows = await sql<{ provider: string | null; n: string; ok: string }[]>`
      select payment_provider as provider,
             count(*)::text as n,
             count(*) filter (where status = 'minted')::text as ok
      from deposit_requests
      where created_at between ${range.from} and ${range.to}
      group by 1 order by count(*) desc
    `
    const summary = rows.length
      ? rows
          .map((r) => {
            const total = num(r.n)
            const rate = total ? `${((num(r.ok) / total) * 100).toFixed(1)}%` : '—'
            return `${r.provider ?? 'unrecorded'}: ${total} at ${rate}`
          })
          .join(' · ')
      : 'no attempts in the period'
    return [
      {
        label: 'Issuance by rail',
        value: rows.length,
        unit: 'rails used',
        provenance: 'deposit_requests grouped by payment_provider; completion is status = minted',
        note: summary,
      },
    ]
  })

  return {
    id: 'operations',
    title: 'Operational statistics',
    question: 'How much moved, through what, for how many people, and how often did it work?',
    figures: [...figures, ...rails],
  }
}

/**
 * Section 5 — reserve and the peg.
 *
 * Read from the attestation series rather than recomputed, so the return and
 * the daily submissions the Bank already holds cannot disagree.
 */
async function reserveSection(range: QueryRange): Promise<Section> {
  const { sql } = getDb()

  const figures = await safe(
    ['Days attested', 'Days fully backed', 'Worst peg deviation', 'nTZS in circulation at period end', 'Days without an attestation', 'Days attested on a qualified basis'],
    async () => {
      const [row] = await sql<
        { days: string; backed: string; worst: string | null; latest_supply: string | null; latest_date: string | null }[]
      >`
        select
          count(*)::text as days,
          count(*) filter (where fully_backed)::text as backed,
          min(deviation_pct)::text as worst,
          (select ntzs_circulation::text from attestations
             where report_date between to_char(${range.from}::date,'YYYY-MM-DD') and to_char(${range.to}::date,'YYYY-MM-DD')
             order by report_date desc limit 1) as latest_supply,
          (select report_date from attestations
             where report_date between to_char(${range.from}::date,'YYYY-MM-DD') and to_char(${range.to}::date,'YYYY-MM-DD')
             order by report_date desc limit 1) as latest_date
        from attestations
        where report_date between to_char(${range.from}::date,'YYYY-MM-DD') and to_char(${range.to}::date,'YYYY-MM-DD')
      `

      // ── The calendar, day by day. The Bank holds one attestation per EAT
      // day; a straight count hides which days are missing and which were
      // attested on substituted evidence. Both need naming, not inferring.
      // 'now + 3h' is the EAT calendar-date trick the attestation itself uses.
      const missing = await sql<{ d: string }[]>`
        select to_char(gs.d, 'YYYY-MM-DD') as d
        from generate_series(
          ${range.from}::date,
          least(${range.to}::date, (now() + interval '3 hours')::date),
          interval '1 day'
        ) as gs(d)
        where not exists (select 1 from attestations a where a.report_date = to_char(gs.d, 'YYYY-MM-DD'))
        order by 1
      `

      // A qualified day carries a reserve pot that was not read live: the
      // custodian's statement, or our own last verified reading carried
      // forward. The annex records each pot's source, so the days are listable
      // rather than asserted.
      const qualified = await sql<{ d: string; sources: string }[]>`
        select report_date as d,
               string_agg(distinct p->>'source', '+') as sources
        from attestations, jsonb_array_elements(annex->'pots') as p
        where report_date between to_char(${range.from}::date,'YYYY-MM-DD') and to_char(${range.to}::date,'YYYY-MM-DD')
          and p->>'source' in ('stale', 'statement')
        group by report_date
        order by report_date
      `

      const days = num(row?.days)
      const backed = num(row?.backed)
      return [
        {
          label: 'Days attested',
          value: days,
          provenance: 'count of attestation rows with report_date inside the period (one immutable row per EAT day)',
          warn: days === 0 ? 'no attestations in this period — check the daily cron before filing' : undefined,
        },
        {
          label: 'Days fully backed',
          value: backed,
          unit: days ? `of ${days}` : undefined,
          provenance: 'attestations where fully_backed is true, i.e. reserve_total >= nTZS in circulation',
          warn: days > 0 && backed < days ? `${days - backed} day(s) were not fully backed — each needs an explanation in the return` : undefined,
        },
        {
          label: 'Worst peg deviation',
          value: row?.worst == null ? null : Number(Number(row.worst).toFixed(4)),
          unit: '%',
          provenance: 'minimum deviation_pct across the period; negative means reserves below circulation',
          unavailable: row?.worst == null ? 'no attestation rows in the period' : undefined,
        },
        {
          label: 'nTZS in circulation at period end',
          value: row?.latest_supply == null ? null : Number(row.latest_supply),
          unit: row?.latest_date ? `TZS · as attested ${row.latest_date}` : 'TZS',
          provenance: 'ntzs_circulation from the latest attestation inside the period',
          unavailable: row?.latest_supply == null ? 'no attestation rows in the period' : undefined,
        },
        {
          label: 'Days without an attestation',
          value: missing.length,
          unit: missing.length ? missing.map((m) => m.d).slice(0, 10).join(', ') + (missing.length > 10 ? ', …' : '') : undefined,
          provenance:
            'EAT calendar days in the period (up to today) with no attestation row — a day the platform refused to attest rather than send a degraded reading',
          warn:
            missing.length > 0
              ? 'each missing day needs its explanation in the return — the Bank can see the hole in the series it already holds'
              : undefined,
        },
        {
          label: 'Days attested on a qualified basis',
          value: qualified.length,
          unit: qualified.length
            ? qualified.map((q) => `${q.d} (${q.sources})`).slice(0, 10).join(', ') + (qualified.length > 10 ? ', …' : '')
            : undefined,
          provenance:
            "attestation rows whose annex carries a reserve pot not read live that day: 'statement' = the custodian's own figure entered by an operator; 'stale' = our last verified reading carried forward",
          warn:
            qualified.length > 0
              ? 'each qualified day should be explained once in the return, with the evidence source named — the daily emails already carry the banner'
              : undefined,
        },
      ]
    }
  )

  return {
    id: 'reserve',
    title: 'Reserve management and the peg',
    question: 'Was every shilling in circulation backed, every day, and can you show it?',
    figures,
  }
}

/**
 * Section 6 — onboarding and consumer protection.
 */
async function consumerSection(range: QueryRange): Promise<Section> {
  const { sql } = getDb()

  const figures = await safe(['Identities verified', 'Verification outcomes'], async () => {
    const rows = await sql<{ status: string; n: string }[]>`
      select status, count(*)::text as n
      from kyc_cases
      where created_at between ${range.from} and ${range.to}
      group by 1 order by count(*) desc
    `
    const total = rows.reduce((s, r) => s + num(r.n), 0)
    const approved = num(rows.find((r) => r.status === 'approved')?.n)
    return [
      {
        label: 'Identities verified',
        value: approved,
        unit: total ? `of ${total} attempts` : undefined,
        provenance: 'kyc_cases reaching status = approved in the period',
        note: 'Verification is a structural prerequisite for issuing a wallet — an unverified person cannot hold nTZS.',
      },
      {
        label: 'Verification outcomes',
        value: rows.length,
        unit: 'distinct outcomes',
        provenance: 'kyc_cases grouped by status',
        note: rows.length ? rows.map((r) => `${r.status}: ${r.n}`).join(' · ') : 'no verification attempts in the period',
      },
    ]
  })

  // The cohort a supervisor would sample first, checked continuously rather
  // than on request. Verification is structural at issuance; this figure
  // re-checks it against who is actually moving money.
  const monitoring = await safe(['Most active participants: identity coverage'], async () => {
    const [row] = await sql<{ total: string; verified: string }[]>`
      with activity as (
        select user_id, count(*) as n from (
          select user_id from deposit_requests
            where created_at between ${range.from} and ${range.to}
          union all
          select user_id from burn_requests
            where created_at between ${range.from} and ${range.to}
        ) t
        group by user_id
        order by count(*) desc
        limit 10
      )
      select count(*)::text as total,
             count(*) filter (where k.status = 'approved')::text as verified
      from activity a
      left join lateral (
        select status from kyc_cases
        where user_id = a.user_id
        order by created_at desc
        limit 1
      ) k on true
    `
    const total = num(row?.total)
    const verified = num(row?.verified)
    return [
      {
        label: 'Most active participants: identity coverage',
        value: total ? `${verified} of ${total} verified` : 'no activity in the period',
        provenance:
          'the ten participants with the most deposits and redemptions in the period (same movement definition as Participants transacting), each joined to their latest kyc_cases status',
        note: 'The participants a supervisor would sample first, re-checked against live activity on every report rather than assembled on request.',
        warn:
          total > 0 && verified < total
            ? `${total - verified} of the most active participants lack an approved verification case — establish why before filing`
            : undefined,
      },
    ]
  })

  return {
    id: 'consumer',
    title: 'Onboarding and consumer protection',
    question: 'Who is allowed in, what are they shown before money moves, and what happens when it goes wrong?',
    figures: [...figures, ...monitoring],
    narrative:
      'Three protections operate on every payment, stated here as controls rather than promises. The payee is named on every quote before the participant confirms: a bill shows the account holder the biller returned, a merchant payment shows the till name carried in the TIPS QR itself. The complete fee is disclosed on the quote before any PIN is entered, and a bill that carries a gateway fee is never presented as free. A payout that fails after the balance was burned returns that balance to the wallet it came from, automatically, with the failure recorded. And a participant who cannot be served — as when a provider suspension removed a network’s deposit rail — receives a written explanation naming the cause and the working alternatives, not a failed screen.',
  }
}

/**
 * How many holders the return names. The full register is exportable and is
 * offered in the caption; a hundred pages of names would obscure the exhibit
 * rather than evidence it.
 */
const HOLDER_ROWS_IN_RETURN = 40

/**
 * What the holder was verified against, in the Bank's vocabulary rather than
 * ours. `selcom_nida` is the name of an integration; what a supervisor needs
 * to know is that the identity was checked against the national register.
 */
function verifierLabel(provider: string | null): string {
  switch (provider) {
    case 'selcom_nida':
    case 'selcom':
      return 'NIDA registry'
    case 'partner_attested':
      return 'Relied-upon partner'
    case 'manual':
      return 'Manual review'
    default:
      return provider ?? 'Not recorded'
  }
}

/**
 * Section 7 — who holds the token.
 *
 * The holder list is public on the block explorer, so the register that
 * matches it to verified identities answers a question the Bank can ask
 * without us. Two disciplines apply:
 *
 * ONLY VERIFIED HOLDERS ARE NAMED, and only with the name the verifier
 * returned — the NIDA registry through our identity provider, or the partner
 * who attested them. A name taken from a self-declared profile would put an
 * unverified claim into a supervisory register, and an email address is not an
 * identity at all.
 *
 * THE COHORT IS REPORTED AS ITS PARTS. Wallets were issued before the sandbox
 * commenced and many of those holders never returned to verify under the
 * standard now in force; they remain on the register. Reporting the total
 * alone is what turns a wallet count into an apparent participant count.
 */
async function holdersSection(): Promise<Section> {
  const view = await loadHoldersView().catch((err) => {
    console.error('[bot-report] holders view failed:', err)
    return null
  })

  if (!view) {
    return {
      id: 'holders',
      title: 'Holders of nTZS and identity coverage',
      question: 'Who holds the token, and is every one of them a verified person?',
      figures: [
        'Wallets on the register',
        'Verified holders',
        'Verified holders holding a balance',
        'Holders without an approved verification',
      ].map((label) => ({
        label,
        value: null,
        provenance: 'not computed',
        unavailable: 'the holder register could not be assembled for this report',
      })),
    }
  }

  const c = view.cohort
  const named = verifiedNamedHolders(view)
  const listed = named.slice(0, HOLDER_ROWS_IN_RETURN)
  const listedBalance = listed.reduce((sum, h) => sum + (h.balanceTzs ?? 0), 0)

  const figures: Figure[] = [
    {
      label: 'Wallets on the register',
      value: c.totalWallets,
      unit: `${c.verified} verified · ${c.unverified} not verified`,
      provenance: 'count of rows in wallets on the reporting chain, joined to their holder',
      note:
        'Not a participant count. Wallets issued before this sandbox commenced remain on the register; holders who ' +
        'have not verified under the standard now in force are reported separately below.',
    },
    {
      label: 'Verified holders',
      value: c.verified,
      unit: `${c.verifiedNamed} carry the verifier's name`,
      provenance:
        "holders whose latest kyc_cases row is approved; the name is the verifier's, read from the case evidence",
      warn:
        c.verified > c.verifiedNamed
          ? `${c.verified - c.verifiedNamed} approved holder(s) carry no verifier name — they cannot be named in the register; establish why before filing`
          : undefined,
    },
    {
      label: 'Verified holders holding a balance',
      value: c.verifiedHolding,
      unit: `${c.verifiedActive30d} transacted in the last 30 days`,
      provenance: 'approved holders whose on-chain balance is above zero, read from the token contract',
    },
    {
      label: 'Holders without an approved verification',
      value: c.unverified,
      unit: `${c.unverifiedHolding} of them hold a balance`,
      provenance: 'holders with no approved kyc_cases row; balance read from the token contract',
      note:
        'Predominantly wallets issued before this sandbox commenced whose holders have not returned to verify. They ' +
        'are outside the tested cohort.',
      warn:
        c.unverifiedHolding > 0
          ? `${c.unverifiedHolding} holder(s) hold a balance without an approved verification — state the remediation in the return`
          : undefined,
    },
  ]

  if (view.chainError) {
    figures.push({
      label: 'On-chain balances',
      value: null,
      provenance: 'not computed',
      unavailable: view.chainError,
    })
  }

  const table: SectionTable = {
    columns: [
      { header: 'Holder (as verified)', weight: 0.38 },
      { header: 'Wallet', weight: 0.23 },
      { header: 'Verified against', weight: 0.19 },
      { header: 'Holding (nTZS)', weight: 0.2, align: 'right' },
    ],
    rows: listed.map((h) => [
      { text: h.verifiedName ?? '—' },
      { text: `${h.address.slice(0, 10)}…${h.address.slice(-6)}` },
      { text: verifierLabel(h.kycProvider) },
      { text: h.balanceTzs == null ? 'not read' : Math.round(h.balanceTzs).toLocaleString() },
    ]),
    caption:
      `Verified holders, largest holding first — ${listed.length} of ${named.length} shown` +
      (named.length > listed.length ? ', the remainder available in the full register on request' : '') +
      `. Listed holdings total ${Math.round(listedBalance).toLocaleString()} nTZS. Wallet addresses are abbreviated; ` +
      'each is verifiable in full against the token contract on the public block explorer.',
  }

  return {
    id: 'holders',
    title: 'Holders of nTZS and identity coverage',
    question: 'Who holds the token, and is every one of them a verified person?',
    figures,
    table: listed.length ? table : undefined,
    narrative:
      'Every holding is attributable to a person. The token contract is public, so the list of addresses holding ' +
      'nTZS can be read by anyone; what follows matches that list to the people behind it. A wallet is issued only ' +
      'after identity verification, and holders are named here exactly as the verifying registry returned them — ' +
      'through the National Identification Authority registry via our identity provider, or by a partner we rely ' +
      'upon under a signed reliance agreement. Wallets issued before this sandbox commenced remain on the register ' +
      'and are reported separately: those holders are outside the tested cohort until they verify under the standard ' +
      'now in force, and the figures below state how many of them hold any balance.',
  }
}

/**
 * Sections that are written rather than computed, kept in the same document so
 * nothing is forgotten.
 *
 * These are DRAFTS in the platform's voice, not filing-ready text: they are
 * deliberately written so the page reads as the story the return will tell —
 * what was built, who it serves, what is being asked — instead of a table of
 * gaps. Every factual claim in them is one the computed sections or the
 * repository can evidence; the bracketed slots are where measured figures go
 * before filing, and nothing else should need to change.
 */
/**
 * The participant-cap request, written from what the period actually measured.
 *
 * The ask is made only when the cohort has in fact outgrown the cap; asking
 * for relief we do not need would be the fastest way to make the next ask
 * unwelcome. The paragraph names the excess rather than implying it, because
 * the same figure is already on the face of the compliance section and a
 * request that soft-pedals what the tables show reads as evasion.
 */
function capReliefParagraph(ctx: NarrativeContext): string {
  if (!ctx.verifiedParticipants || ctx.verifiedParticipants <= SANDBOX_USER_CAP) {
    return (
      'No relief is sought on the participant cap: the verified cohort remains within the approved limit of ' +
      `${SANDBOX_USER_CAP}.`
    )
  }
  return (
    'We seek relief on the participant cap. The approved limit is ' +
    `${SANDBOX_USER_CAP} participants; the cohort verified to the standard now in force stands at ` +
    `${ctx.verifiedParticipants.toLocaleString()}, and demand has arrived faster than the cap anticipated. Our ` +
    'immediate operating position is conservative: we are selecting one hundred participants from within the ' +
    'verified cohort to exercise the utility this pilot exists to test, and it is their activity the next return ' +
    'will carry. But we do not propose to hold verified Tanzanians at the door indefinitely, and we would rather ' +
    'report the position to the Bank than manage the number quietly. We therefore ask the Bank to consider a ' +
    'participant limit set at a level the verified population supports, on the same testing parameters in every ' +
    'other respect — the per-transaction, daily and monthly limits unchanged, verification unchanged, reserve ' +
    'and reporting unchanged. We will supply whatever composition, activity or control evidence the Bank wishes ' +
    'to see in support.'
  )
}

/** What the written sections need from the measured ones. */
interface NarrativeContext {
  /** Holders verified to the current standard, or null when it could not be computed. */
  verifiedParticipants: number | null
}

function narrativeSections(ctx: NarrativeContext): Section[] {
  return [
    {
      id: 'summary',
      title: 'Executive summary',
      question: 'What was tested, what was learned, and what is being asked for?',
      figures: [],
      narrative:
        'nTZS is tested here as settlement infrastructure, not as a product the public holds for its own sake. Participants and merchants transact in Tanzanian Shillings at both ends of every flow; the token exists so that those shillings move immediately, fully collateralised, with every movement attributable to a verified identity. In this period the pilot moved from proving issuance and redemption to proving everyday utility: a participant can scan and pay any merchant already displaying a TIPS “Lipa Namba” code, with the merchant receiving ordinary shillings and nothing to install; can pay government and utility bills with the payee named and the whole fee disclosed before confirming; and can deposit from every mobile network, including a user-initiated path that keeps working when a provider’s push rail cannot. The same capabilities are exposed as a partner API through which partner applications serve their own customers — utility reaching Tanzanians who never see a token. The cohort is deliberate: more than three hundred wallets predate the sandbox, and participation is hand-selected within the approved cap of one hundred, weighted toward participants who will exercise these capabilities daily. Sections 2–6 report the approved parameters binding, incidents in full — including one provider suspension notified to the Bank directly — volumes, the reserve day by day, and the protections around each payment. Sections 7 and 8 state what this establishes about the market and the variations sought.',
    },
    {
      id: 'market',
      title: 'What the pilot established about the market',
      question: 'Does this solve a real problem for Tanzanians, with evidence?',
      figures: [],
      narrative:
        'Claims in this section are limited to what live transactions have measured; replace the bracketed slots from section 4 before filing. Four findings. First, acceptance requires no new infrastructure: any merchant already displaying a TIPS Lipa Namba code can be paid by scanning the sticker on the counter — the pilot has paid real tills this way, decoding and honouring the merchant’s own QR payload — and the merchant receives ordinary shillings with nothing to install and nothing to learn. Second, bills are payable with the price known first: government and utility payments quote the payee by name and the complete fee before confirmation, and the disclosed fee is enforced in code, so what was quoted is what is charged. Third, collection is resilient by design: deposits ran on every mobile network in the period, and when one provider’s suspension removed a push rail, a user-initiated deposit path — the participant paying our published business number from their own mobile-money menu — kept that network’s users served. Fourth, the platform is a rail for others: the partner API (wallets, deposits, payments, QR resolution, identity attestation) is live with partner applications serving their own customers through it, multiplying reach without widening the participant cohort. Add before filing: [volumes and completion rate per rail from section 4] and [the measured cost of one representative bill or merchant payment against the same journey on a mobile-money menu, from a real receipt].',
    },
    {
      id: 'requests',
      title: 'Variations sought',
      question: 'What do you want, and what have you done to earn it?',
      figures: [],
      narrative:
        capReliefParagraph(ctx) +
        ' Two further variation requests are drafted in full and travel with this return: the merchant settlement ' +
        'request and the agent participant class request, each previously shared in correspondence. Each states its ' +
        'own ask, its controls and its evidence in its own document; this section cites them rather than restating ' +
        'them. Any further relief will be sought only where this period actually recorded a refusal — an ask ' +
        'supported by a real participant refused on a real date is a different conversation from an ask supported ' +
        'by a forecast, and the compliance section reports exactly how many such refusals exist.',
    },
  ]
}

export interface Report {
  range: DateRange
  sections: Section[]
  generatedAt: Date
}

export async function buildReport(range: DateRange): Promise<Report> {
  // The single point where Dates become strings — nothing below this line may
  // pass a Date instance to the driver.
  const q = toQueryRange(range)

  // Independent queries; one slow section should not serialise the rest.
  const [parameters, incidents, operations, reserve, consumer, holders] = await Promise.all([
    parameterSection(q),
    incidentSection(q),
    operationsSection(q),
    reserveSection(q),
    consumerSection(q),
    holdersSection(),
  ])

  // The written sections quote measured figures, so they are built from the
  // computed ones rather than kept in step by hand.
  const verifiedFigure = parameters.figures.find((f) => f.label.startsWith('Verified participants'))
  const [summary, market, requests] = narrativeSections({
    verifiedParticipants:
      verifiedFigure && !verifiedFigure.unavailable && typeof verifiedFigure.value === 'number'
        ? verifiedFigure.value
        : null,
  })

  // Ordered as the return is read: the ask last, the compliance first. Holders
  // follow the reserve because they are the other half of the same question —
  // what is backed, and who holds it.
  return {
    range,
    generatedAt: new Date(),
    sections: [summary, parameters, incidents, operations, reserve, holders, consumer, market, requests],
  }
}

/** True when any figure could not be computed — the page warns rather than letting a gap pass unnoticed. */
export function hasUnavailableFigures(report: Report): boolean {
  return report.sections.some((s) => s.figures.some((f) => f.unavailable))
}

/**
 * Everything that must be dealt with before the return is filed: figures that
 * could not be computed, and figures that raised a warning.
 *
 * Both are explicit fields. An earlier version inferred severity from the
 * wording of `note`, which warned on any figure whose explanation happened to
 * contain the word "not" — and a banner that cries wolf is one people learn to
 * click past, which is worse than no banner at all.
 */
export function preFilingWarnings(report: Report): Array<{ section: string; label: string; note: string }> {
  const out: Array<{ section: string; label: string; note: string }> = []
  for (const s of report.sections) {
    for (const f of s.figures) {
      if (f.unavailable) out.push({ section: s.title, label: f.label, note: f.unavailable })
      else if (f.warn) out.push({ section: s.title, label: f.label, note: f.warn })
    }
  }
  return out
}
