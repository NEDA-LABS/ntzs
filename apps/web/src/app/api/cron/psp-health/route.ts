import { NextRequest, NextResponse } from 'next/server'

import { isAuthorizedCron } from '@/lib/cron-auth'
import { getDb } from '@/lib/db'
import { probeRail, railsToMonitor } from '@/lib/psp'
import { sendPoolAlertEmail } from '@/lib/fx/alert-email'

export const maxDuration = 60

/**
 * GET /api/cron/psp-health — every 5 minutes.
 *
 * Probes every rail the current routing plans could use (cheap authenticated
 * balance read, 8s bound) and alerts ops BY TRANSITION: an email when a rail
 * goes down, another when it recovers — never a page per failing probe.
 * Previous state lives in the audit log ('psp.health' entries), which doubles
 * as the R-6 record of rail incidents.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { sql } = getDb()
  const rails = railsToMonitor()
  const results = await Promise.all(rails.map((rail) => probeRail(rail)))
  const current: Record<string, boolean> = Object.fromEntries(results.map((r) => [r.rail, r.healthy]))

  // Previous state = the most recent health entry.
  let previous: Record<string, boolean> = {}
  try {
    const rows = await sql<{ metadata: { state?: Record<string, boolean> } }[]>`
      select metadata from audit_logs
      where action = 'psp.health' and entity_type = 'psp_rail'
      order by created_at desc
      limit 1
    `
    previous = rows[0]?.metadata?.state ?? {}
  } catch (err) {
    console.warn('[psp-health] could not read previous state:', err instanceof Error ? err.message : err)
  }

  const transitions: string[] = []
  for (const r of results) {
    const was = previous[r.rail]
    if (was !== undefined && was !== r.healthy) {
      transitions.push(`${r.rail}: ${was ? 'UP' : 'DOWN'} → ${r.healthy ? 'UP' : 'DOWN'}${r.error ? ` (${r.error})` : ''}`)
    }
  }

  // Persist current state (also the audit/evidence trail of rail incidents).
  try {
    await sql`
      insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
      values ('psp.health', 'psp_rail', 'all', ${JSON.stringify({
        state: current,
        detail: results,
        transitions,
      })}::jsonb, now())
    `
  } catch (err) {
    console.error('[psp-health] failed to persist state:', err instanceof Error ? err.message : err)
  }

  if (transitions.length > 0) {
    const subject = `[nTZS] PSP rail health change: ${transitions.map((t) => t.split(':')[0]).join(', ')}`
    const html = `<p>PSP rail health transition detected:</p><ul>${transitions
      .map((t) => `<li>${t}</li>`)
      .join('')}</ul><p>Current state: ${results
      .map((r) => `${r.rail}=${r.healthy ? 'UP' : `DOWN (${r.error ?? 'unknown'})`}`)
      .join(' · ')}</p><p>Routing fails over automatically where a second rail exists; the burn gate holds redemptions while no disbursement rail is healthy.</p>`
    await sendPoolAlertEmail(subject, html).catch((err) =>
      console.error('[psp-health] alert email failed:', err instanceof Error ? err.message : err)
    )
  }

  return NextResponse.json({ ok: true, state: current, transitions })
}
