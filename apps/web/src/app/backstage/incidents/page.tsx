import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { requireAnyRole } from '@/lib/auth/rbac'
import { writeAuditLog } from '@/lib/audit'
import { getDb } from '@/lib/db'
import { formatDateEAT } from '@/lib/format-date'
import {
  CATEGORIES,
  DETECTED_BY,
  DETECTED_BY_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  STATUSES,
  listIncidents,
  nextIncidentRef,
  registerStats,
  type Incident,
} from '@/lib/incidents/register'
import { incidents } from '@ntzs/db'
import { SubmitButton } from '../_components/SubmitButton'

export const dynamic = 'force-dynamic'

/**
 * The incident register.
 *
 * Written for the question a supervisor actually asks — "show me what has gone
 * wrong and what you changed because of it" — so the page is organised around
 * the answer rather than around the data. Three deliberate constraints:
 *
 *   · There is NO delete action. Entries are updated and every update audits.
 *     A register you can quietly empty is worth nothing to the person reading
 *     it, so the ability to empty it does not exist.
 *
 *   · An entry cannot be recorded without naming the control that was added.
 *     An incident with no control is an incident that will recur, and the form
 *     refuses rather than letting the field stay blank.
 *
 *   · Disclosure to the Bank is an explicit action with a date and an actor.
 *     It is never a side effect of recording something.
 */

const WRITE_ROLES = ['super_admin', 'platform_compliance'] as const

function parseDate(v: FormDataEntryValue | null): Date | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseAmount(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Math.trunc(Number(s.replace(/[\s,]/g, '')))
  // Blank means "not answered". Zero means "answered, and it was none". The
  // difference matters enough that a junk value must not collapse into either.
  return Number.isFinite(n) && n >= 0 ? n : null
}

function oneOf<T extends readonly string[]>(allowed: T, v: FormDataEntryValue | null): T[number] | null {
  const s = String(v ?? '').trim()
  return (allowed as readonly string[]).includes(s) ? (s as T[number]) : null
}

async function recordIncidentAction(formData: FormData) {
  'use server'

  const actor = await requireAnyRole([...WRITE_ROLES])
  const { db } = getDb()

  const ref = String(formData.get('ref') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim()
  const severity = oneOf(SEVERITIES, formData.get('severity'))
  const category = oneOf(CATEGORIES, formData.get('category'))
  const status = oneOf(STATUSES, formData.get('status')) ?? 'open'
  const occurredAt = parseDate(formData.get('occurredAt'))
  const whatHappened = String(formData.get('whatHappened') ?? '').trim()
  const customerImpact = String(formData.get('customerImpact') ?? '').trim()
  const controlAdded = String(formData.get('controlAdded') ?? '').trim()

  if (!ref || !title || !severity || !category || !occurredAt) {
    throw new Error('Reference, title, severity, category and the date it occurred are all required')
  }
  if (!whatHappened || !customerImpact) {
    throw new Error('What happened and customer impact are both required — "none" is a valid answer, blank is not')
  }
  // The one field that makes the register useful rather than decorative.
  if (!controlAdded) {
    throw new Error('Name the control that was added. An incident with no control is one that will recur.')
  }

  await db.insert(incidents).values({
    ref,
    title,
    severity,
    category,
    status,
    occurredAt,
    detectedAt: parseDate(formData.get('detectedAt')),
    resolvedAt: parseDate(formData.get('resolvedAt')),
    detectedBy: oneOf(DETECTED_BY, formData.get('detectedBy')),
    whatHappened,
    customerImpact,
    customersAffected: parseAmount(formData.get('customersAffected')),
    fundsAtRiskTzs: parseAmount(formData.get('fundsAtRiskTzs')),
    fundsLostTzs: parseAmount(formData.get('fundsLostTzs')),
    rootCause: String(formData.get('rootCause') ?? '').trim() || null,
    resolution: String(formData.get('resolution') ?? '').trim() || null,
    controlAdded,
    evidenceRef: String(formData.get('evidenceRef') ?? '').trim() || null,
    createdByUserId: actor.id,
  })

  await writeAuditLog('incident.recorded', 'incident', ref, { title, severity, category }, actor.id)
  revalidatePath('/backstage/incidents')
}

async function updateIncidentAction(formData: FormData) {
  'use server'

  const actor = await requireAnyRole([...WRITE_ROLES])
  const { db } = getDb()

  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing incident id')

  const [existing] = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1)
  if (!existing) throw new Error('Incident not found')

  const status = oneOf(STATUSES, formData.get('status')) ?? existing.status
  const resolution = String(formData.get('resolution') ?? '').trim() || null
  const controlAdded = String(formData.get('controlAdded') ?? '').trim() || null
  const rootCause = String(formData.get('rootCause') ?? '').trim() || null
  const fundsLostTzs = parseAmount(formData.get('fundsLostTzs'))
  const resolvedAt = parseDate(formData.get('resolvedAt')) ?? existing.resolvedAt

  if (status === 'resolved' && !controlAdded) {
    throw new Error('An incident cannot be resolved without a control against it')
  }

  await db
    .update(incidents)
    .set({
      status,
      resolvedAt: status === 'resolved' ? (resolvedAt ?? new Date()) : resolvedAt,
      rootCause,
      resolution,
      controlAdded,
      fundsLostTzs,
      updatedAt: new Date(),
    })
    .where(eq(incidents.id, id))

  await writeAuditLog(
    'incident.updated',
    'incident',
    existing.ref,
    { from: { status: existing.status, fundsLostTzs: existing.fundsLostTzs }, to: { status, fundsLostTzs } },
    actor.id
  )
  revalidatePath('/backstage/incidents')
}

/**
 * Disclosure is its own action, with its own date and its own audit line —
 * never a side effect of editing an entry. What goes into a periodic return is
 * a judgement made by the people who sign it.
 */
async function markDisclosedAction(formData: FormData) {
  'use server'

  const actor = await requireAnyRole([...WRITE_ROLES])
  const { db } = getDb()

  const id = String(formData.get('id') ?? '')
  const botReportRef = String(formData.get('botReportRef') ?? '').trim()
  if (!id) throw new Error('Missing incident id')
  if (!botReportRef) throw new Error('Name the return this was disclosed in — a disclosure with no artefact is not one')

  const [existing] = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1)
  if (!existing) throw new Error('Incident not found')

  await db
    .update(incidents)
    .set({ reportedToBot: true, reportedToBotAt: new Date(), botReportRef, updatedAt: new Date() })
    .where(eq(incidents.id, id))

  await writeAuditLog('incident.disclosed', 'incident', existing.ref, { botReportRef }, actor.id)
  revalidatePath('/backstage/incidents')
}

// ─────────────────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    sev1: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    sev2: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    sev3: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    sev4: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  }
  return (
    <span
      title={SEVERITY_LABELS[severity as keyof typeof SEVERITY_LABELS]}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${styles[severity] ?? styles.sev4}`}
    >
      {severity}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    mitigated: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[status] ?? styles.open}`}>
      {status}
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none'

function Prose({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{value}</p>
    </div>
  )
}

function IncidentRow({ incident: i, canWrite }: { incident: Incident; canWrite: boolean }) {
  return (
    <details className="group border-b border-white/5 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-6 py-4 hover:bg-white/[0.02]">
        <span className="font-mono text-xs text-zinc-500">{i.ref}</span>
        <SeverityBadge severity={i.severity} />
        <span className="min-w-0 flex-1 truncate text-sm text-white">{i.title}</span>
        <span className="hidden text-xs text-zinc-500 sm:inline">{i.category}</span>
        <StatusBadge status={i.status} />
        {i.reportedToBot && (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
            disclosed
          </span>
        )}
        <span className="hidden w-24 text-right text-xs text-zinc-500 md:inline">{formatDateEAT(i.occurredAt)}</span>
      </summary>

      <div className="space-y-5 border-t border-white/5 bg-zinc-950/60 px-6 py-5">
        <div className="grid gap-4 text-xs sm:grid-cols-4">
          <div>
            <p className="text-zinc-500">Occurred</p>
            <p className="text-zinc-300">{formatDateEAT(i.occurredAt)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Detected</p>
            <p className="text-zinc-300">
              {formatDateEAT(i.detectedAt)}
              {i.detectedBy ? ` · ${DETECTED_BY_LABELS[i.detectedBy as keyof typeof DETECTED_BY_LABELS] ?? i.detectedBy}` : ''}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">Resolved</p>
            <p className="text-zinc-300">{formatDateEAT(i.resolvedAt)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Funds lost</p>
            <p className={i.fundsLostTzs == null ? 'text-amber-400' : i.fundsLostTzs > 0 ? 'text-rose-400' : 'text-emerald-400'}>
              {i.fundsLostTzs == null ? 'not established' : `TZS ${i.fundsLostTzs.toLocaleString()}`}
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <Prose label="What happened" value={i.whatHappened} />
            <Prose label="Customer impact" value={i.customerImpact} />
          </div>
          <div className="space-y-4">
            <Prose label="Root cause" value={i.rootCause} />
            <Prose label="Resolution" value={i.resolution} />
            <Prose label="Control added" value={i.controlAdded} />
            {i.evidenceRef && (
              <p className="text-xs text-zinc-500">
                Evidence: <span className="text-zinc-400">{i.evidenceRef}</span>
              </p>
            )}
          </div>
        </div>

        {/* Read-only roles (the Bank's own portal login, fund managers) see the
            record but not the controls that change it. The server actions
            enforce this independently — this only stops the page from
            offering an action that would be refused. */}
        {!canWrite ? null : (
        <div className="grid gap-5 border-t border-white/5 pt-5 lg:grid-cols-2">
          <form action={updateIncidentAction} className="space-y-3">
            <input type="hidden" name="id" value={i.id} />
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Update</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status">
                <select name="status" defaultValue={i.status} className={inputCls}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Resolved on">
                <input
                  type="date"
                  name="resolvedAt"
                  defaultValue={i.resolvedAt ? i.resolvedAt.toISOString().slice(0, 10) : ''}
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Funds lost, TZS — blank means not yet established">
              <input
                name="fundsLostTzs"
                defaultValue={i.fundsLostTzs ?? ''}
                placeholder="0"
                className={inputCls}
              />
            </Field>
            <Field label="Root cause">
              <textarea name="rootCause" defaultValue={i.rootCause ?? ''} rows={3} className={inputCls} />
            </Field>
            <Field label="Resolution">
              <textarea name="resolution" defaultValue={i.resolution ?? ''} rows={3} className={inputCls} />
            </Field>
            <Field label="Control added — required to resolve">
              <textarea name="controlAdded" defaultValue={i.controlAdded ?? ''} rows={3} className={inputCls} />
            </Field>
            <SubmitButton
              pendingText="Saving…"
              className="rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15"
            >
              Save
            </SubmitButton>
          </form>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Disclosure to the Bank</p>
            {i.reportedToBot ? (
              <p className="mt-2 text-sm text-emerald-300">
                Disclosed {formatDateEAT(i.reportedToBotAt)}
                {i.botReportRef ? ` in ${i.botReportRef}` : ''}
              </p>
            ) : (
              <form action={markDisclosedAction} className="mt-2 space-y-3">
                <input type="hidden" name="id" value={i.id} />
                <p className="text-xs leading-relaxed text-zinc-500">
                  Recording an incident does not disclose it. Mark it here once it appears in a return, naming the
                  return, so the register can show at a glance what the Bank has and has not been told.
                </p>
                <Field label="Return it appears in">
                  <input name="botReportRef" placeholder="e.g. Milestone report, 31 Aug 2026" className={inputCls} />
                </Field>
                <SubmitButton
                  pendingText="Recording…"
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/15"
                >
                  Mark as disclosed
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
        )}
      </div>
    </details>
  )
}

export default async function IncidentsPage() {
  // Read is wider than write on purpose: the register is meant to be looked at,
  // including by the roles that supervise us. Writing it is a compliance
  // function.
  const actor = await requireAnyRole([
    'super_admin',
    'platform_compliance',
    'bank_admin',
    'bot_regulator',
    'fund_manager',
  ])
  const canWrite = (WRITE_ROLES as readonly string[]).includes(actor.role)

  const { rows, schemaPending } = await listIncidents()
  const stats = registerStats(rows)
  const suggestedRef = nextIncidentRef(rows, new Date())

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Incident Register</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            What went wrong, who it affected, and what changed because of it. Curated by hand — the activity feed
            already records everything the system does; this records the things a person judged worth writing down.
            Entries are never deleted, and every edit is audited.
          </p>
        </div>
      </div>

      <div className="p-8">
        {schemaPending && (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <span className="font-semibold">Migration pending.</span> drizzle/0070_incident_register.sql has not been
            applied to this database yet, so the register reads as empty. Apply it and the backfilled entries appear.
          </div>
        )}

        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-white">{stats.total}</p>
            <p className="text-sm text-zinc-500">Recorded</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-2xl font-bold text-amber-400">{stats.material}</p>
            <p className="text-sm text-zinc-500">
              Material <span className="text-zinc-600">· sev1–2</span>
            </p>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
            <p className="text-2xl font-bold text-rose-400">{stats.open}</p>
            <p className="text-sm text-zinc-500">Still open</p>
          </div>
          <div
            className={`rounded-xl border p-4 ${
              stats.fundsLostTzs > 0 ? 'border-rose-500/30 bg-rose-500/10' : 'border-emerald-500/20 bg-emerald-500/5'
            }`}
          >
            <p className={`text-2xl font-bold ${stats.fundsLostTzs > 0 ? 'text-rose-300' : 'text-emerald-400'}`}>
              {stats.fundsLostTzs.toLocaleString()}
            </p>
            <p className="text-sm text-zinc-500">
              TZS lost by customers
              {stats.lossUnknown > 0 && (
                <span className="text-amber-400"> · {stats.lossUnknown} not established</span>
              )}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-white">{stats.reportedToBot}</p>
            <p className="text-sm text-zinc-500">Disclosed to the Bank</p>
          </div>
        </div>

        {/* How it was found — a register where nothing is ever caught by
            monitoring is telling you something about the monitoring. */}
        {rows.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="uppercase tracking-wide">How they were found:</span>
            {Object.entries(stats.byDetectedBy)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <span key={k} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-zinc-400">
                  {DETECTED_BY_LABELS[k as keyof typeof DETECTED_BY_LABELS] ?? k} · {n}
                </span>
              ))}
            {stats.meanDaysToResolve != null && (
              <span className="ml-auto text-zinc-500">
                Mean time to resolve: {stats.meanDaysToResolve.toFixed(1)} days
              </span>
            )}
          </div>
        )}

        {canWrite && (
        <details className="mb-6 rounded-2xl border border-white/10 bg-zinc-900/50">
          <summary className="cursor-pointer list-none px-6 py-4 text-sm font-medium text-white hover:bg-white/[0.02]">
            + Record an incident
          </summary>
          <form action={recordIncidentAction} className="space-y-4 border-t border-white/5 px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Reference">
                <input name="ref" defaultValue={suggestedRef} className={inputCls} />
              </Field>
              <Field label="Severity">
                <select name="severity" defaultValue="sev3" className={inputCls}>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s} — {SEVERITY_LABELS[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select name="category" defaultValue="availability" className={inputCls}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Title">
              <input name="title" placeholder="One line, in plain words, describing what went wrong" className={inputCls} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Occurred">
                <input type="date" name="occurredAt" className={inputCls} />
              </Field>
              <Field label="Detected">
                <input type="date" name="detectedAt" className={inputCls} />
              </Field>
              <Field label="Resolved">
                <input type="date" name="resolvedAt" className={inputCls} />
              </Field>
              <Field label="Found by">
                <select name="detectedBy" defaultValue="internal_review" className={inputCls}>
                  {DETECTED_BY.map((d) => (
                    <option key={d} value={d}>
                      {DETECTED_BY_LABELS[d]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="What happened">
              <textarea
                name="whatHappened"
                rows={4}
                placeholder="Plain narrative. Someone reading this in six months should not need the code to understand it."
                className={inputCls}
              />
            </Field>

            <Field label="Customer impact — “none” is a valid answer, blank is not">
              <textarea name="customerImpact" rows={3} className={inputCls} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Customers affected">
                <input name="customersAffected" placeholder="blank = not established" className={inputCls} />
              </Field>
              <Field label="Funds at risk, TZS">
                <input name="fundsAtRiskTzs" placeholder="blank = not established" className={inputCls} />
              </Field>
              <Field label="Funds lost, TZS">
                <input name="fundsLostTzs" placeholder="0 if none — blank if unknown" className={inputCls} />
              </Field>
            </div>

            <Field label="Root cause">
              <textarea name="rootCause" rows={3} placeholder="Why it was possible, not just what the bug was." className={inputCls} />
            </Field>
            <Field label="Resolution">
              <textarea name="resolution" rows={2} className={inputCls} />
            </Field>
            <Field label="Control added — required">
              <textarea
                name="controlAdded"
                rows={3}
                placeholder="What now makes this structurally harder: a test, a gate, a chokepoint. Required."
                className={inputCls}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Evidence">
                <input name="evidenceRef" placeholder="PR number, commit, log query" className={inputCls} />
              </Field>
              <Field label="Status">
                <select name="status" defaultValue="resolved" className={inputCls}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <SubmitButton
              pendingText="Recording…"
              className="rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/30"
            >
              Record incident
            </SubmitButton>
          </form>
        </details>
        )}

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/50">
          {rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-zinc-500">
              {schemaPending ? 'Waiting on the migration.' : 'Nothing recorded yet.'}
            </p>
          ) : (
            rows.map((i) => <IncidentRow key={i.id} incident={i} canWrite={canWrite} />)
          )}
        </div>
      </div>
    </div>
  )
}
