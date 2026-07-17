/**
 * Backstage Activity & Logs — one queryable stream over everything the
 * platform already records: audit_logs (payout engine, PSP health, KYC
 * decisions, admin actions, partner lookups) plus the lifecycle state of
 * deposits, burns, orphan payments and KYC cases.
 *
 * Severity and category are DERIVED here (pure, unit-tested) — writers never
 * had to declare them, so historical rows classify identically to new ones.
 */
import { getDb } from '@/lib/db'

export type Severity = 'error' | 'warning' | 'info'
export type Category =
  | 'psp'
  | 'payment'
  | 'burn'
  | 'kyc'
  | 'partner'
  | 'enterprise'
  | 'admin'
  | 'other'

export interface ActivityEvent {
  ts: Date
  source: string
  action: string
  entityType: string | null
  entityId: string | null
  actor: string | null
  detail: Record<string, unknown> | null
  severity: Severity
  category: Category
}

export const RANGE_HOURS: Record<string, number> = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '7d': 168,
  '30d': 720,
}

export function parseRange(raw: string | undefined): { key: string; hours: number } {
  const key = raw && RANGE_HOURS[raw] ? raw : '24h'
  return { key, hours: RANGE_HOURS[key] }
}

/**
 * Severity rules, most specific first:
 * - psp.health entries are 'warning' at the moment of a transition, 'info'
 *   otherwise — steady-state DOWN lives in the health strip, not as a page
 *   of repeated errors every 5 minutes.
 * - KYC rejections (and other human decisions containing 'reject') are
 *   'warning': an operator outcome, not a platform fault.
 * - fail/error/gate_closed/expired/revert → 'error'.
 * - in-between states (pending, orphan, requires_, down…) → 'warning'.
 */
export function classifyEvent(action: string, detail: unknown): Severity {
  const a = action.toLowerCase()
  if (a === 'psp.health') {
    const transitions = (detail as { transitions?: unknown[] } | null)?.transitions
    return Array.isArray(transitions) && transitions.length > 0 ? 'warning' : 'info'
  }
  if (/failover|failed_over/.test(a)) return 'warning'
  if (/kyc[._]rejected/.test(a)) return 'warning'
  if (/fail|error|gate_closed|expired|revert|dead/.test(a)) return 'error'
  if (/reject/.test(a)) return 'warning'
  if (/orphan|unmatched|pending|requires_|awaiting|review|down|paused|dismissed|skip/.test(a)) {
    return 'warning'
  }
  return 'info'
}

export function categorizeEvent(
  source: string,
  action: string,
  entityType: string | null,
  hasActor: boolean
): Category {
  const a = action.toLowerCase()
  if (source === 'deposit' || source === 'orphan') return 'payment'
  if (source === 'burn') return 'burn'
  if (source === 'kyc') return 'kyc'
  if (a.startsWith('psp.')) return 'psp'
  if (/^(payout_|burn_)/.test(a)) return 'burn'
  if (/^kyc[._]/.test(a)) return 'kyc'
  if (a.startsWith('partner.') || entityType === 'partner') return 'partner'
  if (/lender|loan|settlement|enterprise|disburs/.test(a)) return 'enterprise'
  if (/deposit|mint|orphan|payment/.test(a)) return 'payment'
  // A human actor on an unrecognized action = an operator doing something in
  // backstage; actor-less unknowns are machine events we haven't mapped yet.
  return hasActor ? 'admin' : 'other'
}

interface RawRow {
  ts: Date
  source: string
  action: string
  entity_type: string | null
  entity_id: string | null
  actor: string | null
  detail: Record<string, unknown> | null
}

function toEvent(r: RawRow): ActivityEvent {
  return {
    ts: r.ts,
    source: r.source,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actor: r.actor,
    detail: r.detail,
    severity: classifyEvent(r.action, r.detail),
    category: categorizeEvent(r.source, r.action, r.entity_type, Boolean(r.actor)),
  }
}

const PER_SOURCE_CAP = 500

/**
 * Everything in range, newest first. Each source is queried INDEPENDENTLY and
 * fail-soft: this page is the debugging tool, so one missing table or drifted
 * column (migrations are applied manually here) must never 500 the whole tab —
 * it becomes a named error in `sourceErrors`, rendered as a banner instead.
 */
export async function fetchActivity(opts: { hours: number; q?: string }): Promise<{
  events: ActivityEvent[]
  truncated: boolean
  sourceErrors: string[]
}> {
  const { sql } = getDb()
  const { hours } = opts
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null

  const sourceErrors: string[] = []
  const guarded = async (name: string, run: () => Promise<RawRow[]>): Promise<RawRow[]> => {
    try {
      return await run()
    } catch (err) {
      sourceErrors.push(`${name}: ${err instanceof Error ? err.message : 'query failed'}`)
      return []
    }
  }

  const [audit, deposits, burns, kyc, orphans] = await Promise.all([
    guarded('audit log', () => sql<RawRow[]>`
      select al.created_at as ts, 'audit' as source, al.action,
             al.entity_type, al.entity_id, u.email as actor, al.metadata as detail
        from audit_logs al
        left join users u on u.id = al.actor_user_id
       where al.created_at > now() - ${hours} * interval '1 hour'
         and (${q}::text is null
              or al.action ilike ${q}
              or coalesce(al.entity_id, '') ilike ${q}
              or coalesce(al.metadata::text, '') ilike ${q}
              or coalesce(u.email, '') ilike ${q})
       order by al.created_at desc
       limit ${PER_SOURCE_CAP}
    `),
    guarded('deposits', () => sql<RawRow[]>`
      select greatest(d.created_at, d.updated_at) as ts, 'deposit' as source,
             'deposit.' || d.status::text as action, 'deposit_request' as entity_type,
             d.id::text as entity_id, null as actor,
             jsonb_build_object('amountTzs', d.amount_tzs, 'provider', d.payment_provider,
                                'pspReference', d.psp_reference, 'channel', d.psp_channel,
                                'phone', d.buyer_phone, 'origin', d.source) as detail
        from deposit_requests d
       where greatest(d.created_at, d.updated_at) > now() - ${hours} * interval '1 hour'
         and (${q}::text is null
              or d.id::text ilike ${q}
              or coalesce(d.psp_reference, '') ilike ${q}
              or coalesce(d.buyer_phone, '') ilike ${q}
              or d.status::text ilike ${q})
       order by 1 desc
       limit ${PER_SOURCE_CAP}
    `),
    guarded('burns', () => sql<RawRow[]>`
      select greatest(b.created_at, b.updated_at) as ts, 'burn' as source,
             'burn.' || b.status::text as action, 'burn_request' as entity_type,
             b.id::text as entity_id, null as actor,
             jsonb_build_object('amountTzs', b.amount_tzs, 'payoutStatus', b.payout_status,
                                'payoutError', b.payout_error, 'error', b.error,
                                'phone', b.recipient_phone, 'txHash', b.tx_hash) as detail
        from burn_requests b
       where greatest(b.created_at, b.updated_at) > now() - ${hours} * interval '1 hour'
         and (${q}::text is null
              or b.id::text ilike ${q}
              or coalesce(b.payout_reference, '') ilike ${q}
              or coalesce(b.recipient_phone, '') ilike ${q}
              or coalesce(b.payout_error, '') ilike ${q}
              or coalesce(b.error, '') ilike ${q})
       order by 1 desc
       limit ${PER_SOURCE_CAP}
    `),
    guarded('kyc cases', () => sql<RawRow[]>`
      select greatest(k.created_at, k.updated_at) as ts, 'kyc' as source,
             'kyc.' || k.status as action, 'kyc_case' as entity_type,
             k.id::text as entity_id, null as actor,
             jsonb_build_object('provider', k.provider, 'reason', k.review_reason) as detail
        from kyc_cases k
       where greatest(k.created_at, k.updated_at) > now() - ${hours} * interval '1 hour'
         and (${q}::text is null
              or k.id::text ilike ${q}
              or coalesce(k.review_reason, '') ilike ${q})
       order by 1 desc
       limit ${PER_SOURCE_CAP}
    `),
    // Orphans ship as a manually-applied migration — absent table is expected,
    // so it reports no error, just zero rows.
    (async () => {
      try {
        return await sql<RawRow[]>`
          select greatest(o.received_at, o.updated_at) as ts, 'orphan' as source,
                 'orphan.' || o.status as action, 'orphan_payment' as entity_type,
                 o.id::text as entity_id, null as actor,
                 jsonb_build_object('amountTzs', o.amount_tzs, 'provider', o.provider,
                                    'pspReference', o.psp_reference, 'phone', o.payer_phone,
                                    'payerName', o.payer_name, 'notes', o.notes) as detail
            from orphan_payments o
           where greatest(o.received_at, o.updated_at) > now() - ${hours} * interval '1 hour'
             and (${q}::text is null
                  or o.psp_reference ilike ${q}
                  or coalesce(o.payer_phone, '') ilike ${q}
                  or coalesce(o.payer_name, '') ilike ${q})
           order by 1 desc
           limit 200
        `
      } catch {
        return []
      }
    })(),
  ])

  const events = [...audit, ...deposits, ...burns, ...kyc, ...orphans]
    .map(toEvent)
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())

  const truncated = [audit, deposits, burns, kyc].some((rows) => rows.length >= PER_SOURCE_CAP)
  return { events, truncated, sourceErrors }
}

export interface RailHealth {
  checkedAt: Date | null
  rails: Array<{ rail: string; healthy: boolean; error?: string }>
}

/** Latest PSP health probe (also reveals a dead cron via its age). */
export async function fetchRailHealth(): Promise<RailHealth> {
  const { sql } = getDb()
  try {
    const rows = await sql<Array<{ metadata: { detail?: Array<{ rail: string; healthy: boolean; error?: string }> } | null; created_at: Date }>>`
      select metadata, created_at from audit_logs
       where action = 'psp.health' and entity_type = 'psp_rail'
       order by created_at desc limit 1
    `
    if (!rows[0]) return { checkedAt: null, rails: [] }
    return { checkedAt: rows[0].created_at, rails: rows[0].metadata?.detail ?? [] }
  } catch {
    return { checkedAt: null, rails: [] }
  }
}

export interface StuckWork {
  depositsSubmitted: number
  depositsStuck: number
  mintFailed: number
  mintRequiresSafe: number
  payoutFailed: number
  burnFailed: number
  burnsInFlight: number
  orphansUnmatched: number
  kycPending: number
  errors: string[]
}

/**
 * Current queue depths — things an operator may need to act on right now.
 * Each counter query is individually guarded; a failure zeroes its counters
 * and reports a named error instead of taking the page down.
 */
export async function fetchStuckWork(): Promise<StuckWork> {
  const { sql } = getDb()
  const errors: string[] = []

  const dep = await sql<Array<{ submitted: number; stuck: number; mint_failed: number; requires_safe: number }>>`
    select count(*) filter (where status = 'submitted')::int as submitted,
           count(*) filter (where status = 'submitted' and created_at < now() - interval '10 minutes')::int as stuck,
           count(*) filter (where status = 'mint_failed')::int as mint_failed,
           count(*) filter (where status = 'mint_requires_safe')::int as requires_safe
      from deposit_requests
  `.then((r) => r[0]).catch((err) => {
    errors.push(`deposit counters: ${err instanceof Error ? err.message : 'query failed'}`)
    return undefined
  })

  const brn = await sql<Array<{ payout_failed: number; burn_failed: number; in_flight: number }>>`
    select count(*) filter (where payout_status = 'failed')::int as payout_failed,
           count(*) filter (where status = 'failed')::int as burn_failed,
           count(*) filter (where status in ('approved', 'burn_submitted'))::int as in_flight
      from burn_requests
  `.then((r) => r[0]).catch((err) => {
    errors.push(`burn counters: ${err instanceof Error ? err.message : 'query failed'}`)
    return undefined
  })

  const kyc = await sql<Array<{ pending: number }>>`
    select count(*) filter (where status = 'pending')::int as pending from kyc_cases
  `.then((r) => r[0]).catch((err) => {
    errors.push(`kyc counters: ${err instanceof Error ? err.message : 'query failed'}`)
    return undefined
  })

  let orphansUnmatched = 0
  try {
    const [o] = await sql<Array<{ unmatched: number }>>`
      select count(*) filter (where status = 'unmatched')::int as unmatched from orphan_payments
    `
    orphansUnmatched = o?.unmatched ?? 0
  } catch {
    // table ships as a manual migration — absence is expected, not an error
  }

  return {
    depositsSubmitted: dep?.submitted ?? 0,
    depositsStuck: dep?.stuck ?? 0,
    mintFailed: dep?.mint_failed ?? 0,
    mintRequiresSafe: dep?.requires_safe ?? 0,
    payoutFailed: brn?.payout_failed ?? 0,
    burnFailed: brn?.burn_failed ?? 0,
    burnsInFlight: brn?.in_flight ?? 0,
    orphansUnmatched,
    kycPending: kyc?.pending ?? 0,
    errors,
  }
}
