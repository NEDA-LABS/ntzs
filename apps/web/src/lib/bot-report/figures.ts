import { getDb } from '@/lib/db'
import { isMissingSchemaObject } from '@/lib/db-errors'
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
}

export interface Section {
  id: string
  title: string
  /** The supervisory question this section answers. */
  question: string
  figures: Figure[]
  /** Sections that are narrative rather than computed say so here. */
  narrative?: string
}

export interface DateRange {
  from: Date
  to: Date
}

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
async function parameterSection(range: DateRange): Promise<Section> {
  const { sql } = getDb()

  const figures = await safe(
    ['Participants (Parameter 2)', 'Largest single transaction (Parameter 3)', 'Largest participant day (Parameter 4)', 'Largest participant 30-day total (Parameter 5)'],
    async () => {
      const [participants] = await sql<{ n: string }[]>`
        select count(distinct w.user_id)::text as n
        from wallets w
        join users u on u.id = w.user_id
        where u.role = 'end_user' and w.created_at <= ${range.to}
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

      const participantCount = num(participants?.n)
      const maxTxn = num(largestTxn?.n)
      const maxDay = num(largestDay?.n)
      const maxPeriod = num(largestMonth?.n)

      return [
        {
          label: 'Participants (Parameter 2)',
          value: participantCount,
          unit: `of ${SANDBOX_USER_CAP} permitted`,
          provenance: 'count(distinct wallets.user_id) joined to users where role = end_user and the wallet existed on or before the period end',
          note: 'Includes merchants: a collection mints nTZS to the merchant, so they hold the token and count as a participant.',
          warn: participantCount > SANDBOX_USER_CAP ? 'above the permitted cohort of ' + SANDBOX_USER_CAP : undefined,
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
  }
}

/**
 * Section 3 — incidents, shortcomings and errors.
 *
 * Reported from the register rather than written fresh, so the return cannot
 * quietly contain a shorter list than the internal record.
 */
async function incidentSection(range: DateRange): Promise<Section> {
  const { sql } = getDb()

  const figures = await safe(
    ['Incidents recorded', 'Material incidents', 'Customer funds lost', 'Still open at period end'],
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
async function operationsSection(range: DateRange): Promise<Section> {
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
async function reserveSection(range: DateRange): Promise<Section> {
  const { sql } = getDb()

  const figures = await safe(
    ['Days attested', 'Days fully backed', 'Worst peg deviation', 'nTZS in circulation at period end'],
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
async function consumerSection(range: DateRange): Promise<Section> {
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

  return {
    id: 'consumer',
    title: 'Onboarding and consumer protection',
    question: 'Who is allowed in, what are they shown before money moves, and what happens when it goes wrong?',
    figures,
    narrative:
      'Narrative to add before filing: the payee name shown on every quote before confirmation, the full fee breakdown disclosed at quote time, and the treatment of a failed payout (the burned balance is returned to the wallet it was taken from).',
  }
}

/** Sections that are written rather than computed, kept in the same document so nothing is forgotten. */
function narrativeSections(): Section[] {
  return [
    {
      id: 'summary',
      title: 'Executive summary',
      question: 'What was tested, what was learned, and what is being asked for?',
      figures: [],
      narrative:
        'Write last, from the sections below. State the ask plainly: what the pilot demonstrated, which constraint is now the binding one, and what variation would let the next period test something the current parameters cannot.',
    },
    {
      id: 'market',
      title: 'What the pilot established about the market',
      question: 'Does this solve a real problem for Tanzanians, with evidence?',
      figures: [],
      narrative:
        'Cost comparison against mobile money on verified receipts, the merchant collection findings, and the agent float work. Use measured figures from live transactions only — a comparison a supervisor can check against their own phone is worth more than a projection.',
    },
    {
      id: 'requests',
      title: 'Variations sought',
      question: 'What do you want, and what have you done to earn it?',
      figures: [],
      narrative:
        'The agent participant class request, and any cap relief supported by refusals actually recorded in the period. An ask backed by a row in sandbox_limit_events — a real participant, a real refusal, a real date — is a different conversation from an ask backed by a forecast.',
    },
  ]
}

export interface Report {
  range: DateRange
  sections: Section[]
  generatedAt: Date
}

export async function buildReport(range: DateRange): Promise<Report> {
  // Independent queries; one slow section should not serialise the rest.
  const [parameters, incidents, operations, reserve, consumer] = await Promise.all([
    parameterSection(range),
    incidentSection(range),
    operationsSection(range),
    reserveSection(range),
    consumerSection(range),
  ])

  const [summary, market, requests] = narrativeSections()

  // Ordered as the return is read: the ask last, the compliance first.
  return {
    range,
    generatedAt: new Date(),
    sections: [summary, parameters, incidents, operations, reserve, consumer, market, requests],
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
