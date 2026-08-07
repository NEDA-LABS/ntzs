import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { formatDateEAT } from '@/lib/format-date'
import {
  buildReport,
  preFilingWarnings,
  type Figure,
  type Section,
} from '@/lib/bot-report/figures'

import { ExportReturnButton } from './ExportReturnButton'

export const dynamic = 'force-dynamic'

/**
 * The periodic return to the Bank of Tanzania, generated rather than assembled.
 *
 * Architecture and filing discipline: docs/bot/milestone-report-architecture.md.
 *
 * Every figure prints the derivation that produced it, and anything that could
 * not be computed — or that breached an approved parameter — is raised at the
 * top as a pre-filing warning rather than left to be spotted in the table. The
 * page is deliberately plain: it is read to be transcribed, not admired.
 */

/**
 * Default period start. The commencement date from the Bank's letter belongs in
 * BOT_SANDBOX_COMMENCED_ON; until it is set we fall back to the first day we
 * actually attested, which is a fact rather than a guess.
 */
async function defaultFrom(): Promise<{ date: Date; source: string }> {
  const configured = process.env.BOT_SANDBOX_COMMENCED_ON
  if (configured) {
    const d = new Date(configured)
    if (!Number.isNaN(d.getTime())) return { date: d, source: 'BOT_SANDBOX_COMMENCED_ON' }
  }
  try {
    const { sql } = getDb()
    const [row] = await sql<{ d: string | null }[]>`select min(report_date) as d from attestations`
    if (row?.d) return { date: new Date(`${row.d}T00:00:00Z`), source: 'earliest attestation on record' }
  } catch {
    // Fall through — a missing table must not stop the page rendering.
  }
  const fallback = new Date()
  fallback.setUTCDate(fallback.getUTCDate() - 30)
  return { date: fallback, source: 'last 30 days (no commencement date configured, no attestations found)' }
}

function FigureCard({ figure }: { figure: Figure }) {
  return (
    <div className="border-b border-white/5 px-6 py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm text-zinc-400">{figure.label}</span>
        {figure.unavailable ? (
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-sm font-medium text-amber-300">
            unavailable
          </span>
        ) : (
          <span className="text-lg font-semibold text-white">
            {typeof figure.value === 'number' ? figure.value.toLocaleString() : figure.value}
          </span>
        )}
        {figure.unit && !figure.unavailable && <span className="text-xs text-zinc-500">{figure.unit}</span>}
      </div>

      {figure.unavailable ? (
        <p className="mt-1 text-xs text-amber-400/80">{figure.unavailable}</p>
      ) : (
        <>
          {figure.warn && <p className="mt-1 text-xs font-medium text-rose-400">{figure.warn}</p>}
          {figure.note && <p className="mt-1 text-xs text-zinc-500">{figure.note}</p>}
        </>
      )}

      {/* The provenance line is the point of the page: a number in a supervisory
          return should be re-derivable by whoever signs it. */}
      <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-zinc-600">{figure.provenance}</p>
    </div>
  )
}

function SectionBlock({ section, index }: { section: Section; index: number }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/50">
      <header className="border-b border-white/5 px-6 py-4">
        <h2 className="text-sm font-semibold text-white">
          <span className="mr-2 text-zinc-600">{index}.</span>
          {section.title}
        </h2>
        <p className="mt-1 text-xs italic text-zinc-500">{section.question}</p>
      </header>

      {section.figures.length > 0 && <div>{section.figures.map((f) => <FigureCard key={f.label} figure={f} />)}</div>}

      {section.table && (
        <div className="border-t border-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500">
                  {section.table.columns.map((c) => (
                    <th key={c.header} className={`px-6 py-3 ${c.align === 'right' ? 'text-right' : ''}`}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-b-0">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-6 py-2.5 ${section.table!.columns[j]?.align === 'right' ? 'text-right' : ''} ${
                          j === 0 ? 'text-zinc-200' : 'text-zinc-400'
                        }`}
                      >
                        {cell.text}
                        {cell.sub && <span className="ml-2 text-xs text-zinc-600">{cell.sub}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {section.table.caption && (
            <p className="px-6 py-3 text-xs leading-relaxed text-zinc-600">{section.table.caption}</p>
          )}
        </div>
      )}

      {section.narrative && (
        <p className="border-t border-white/5 bg-zinc-950/40 px-6 py-4 text-xs leading-relaxed text-zinc-400">
          {section.figures.length === 0 && (
            <span className="mr-2 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
              draft — edit before filing
            </span>
          )}
          {section.narrative}
        </p>
      )}
    </section>
  )
}

export default async function BotReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireAnyRole(['super_admin', 'platform_compliance', 'bank_admin', 'bot_regulator', 'fund_manager'])

  const params = await searchParams
  const fallbackFrom = await defaultFrom()

  const parsed = params.from ? new Date(params.from) : null
  const from = parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallbackFrom.date
  const fromSource = parsed && !Number.isNaN(parsed.getTime()) ? 'set on this page' : fallbackFrom.source

  const parsedTo = params.to ? new Date(params.to) : null
  const to = parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : new Date()

  const report = await buildReport({ from, to })
  const warnings = preFilingWarnings(report)

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="flex flex-wrap items-end justify-between gap-4 px-8 py-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Periodic return — Bank of Tanzania</h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Generated, not assembled. Every figure prints the derivation behind it, so whoever signs the return can
              re-derive it and the next period uses the same definitions. Anything that could not be computed is shown
              as unavailable — never as zero.
            </p>
          </div>
          <ExportReturnButton report={report} warnings={warnings} />
        </div>
      </div>

      <div className="space-y-6 p-8">
        <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-zinc-900/50 px-6 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Period from</span>
            <input
              type="date"
              name="from"
              defaultValue={from.toISOString().slice(0, 10)}
              className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">to</span>
            <input
              type="date"
              name="to"
              defaultValue={to.toISOString().slice(0, 10)}
              className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15"
          >
            Generate
          </button>
          <p className="ml-auto text-xs text-zinc-600">
            Period start: {fromSource} · generated {formatDateEAT(report.generatedAt)}
          </p>
        </form>

        {warnings.length > 0 ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-4">
            <p className="text-sm font-semibold text-rose-200">
              {warnings.length} item{warnings.length === 1 ? '' : 's'} to clear before this is filed
            </p>
            <ul className="mt-2 space-y-1 text-xs text-rose-200/80">
              {warnings.map((w, idx) => (
                <li key={`${w.section}-${w.label}-${idx}`}>
                  <span className="text-rose-300/70">{w.section} · </span>
                  <span className="font-medium">{w.label}</span> — {w.note}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-6 py-4 text-sm text-emerald-300">
            Every figure computed, and no approved parameter was breached in this period.
          </div>
        )}

        {report.sections.map((s, i) => (
          <SectionBlock key={s.id} section={s} index={i + 1} />
        ))}

        <p className="pb-4 text-xs leading-relaxed text-zinc-600">
          Filing discipline is in <span className="font-mono">docs/bot/milestone-report-architecture.md</span>. Clear
          every warning above, write the narrative sections, copy each disclosed incident verbatim from the register,
          then mark it disclosed there naming this return.
        </p>
      </div>
    </div>
  )
}
