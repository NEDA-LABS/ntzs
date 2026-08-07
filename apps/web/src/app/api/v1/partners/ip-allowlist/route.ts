import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { isMissingSchemaObject } from '@/lib/db-errors'
import { verifyPartnerSession } from '@/lib/waas/auth'
import { parseAllowlistEntry } from '@/lib/waas/ip-allowlist'
import { writeAuditLog } from '@/lib/audit'
import { partners } from '@ntzs/db'

/**
 * GET / PUT /api/v1/partners/ip-allowlist — manage the partner's API source-IP
 * allowlist (issue #231).
 *
 * SESSION AUTH ONLY, deliberately. The allowlist exists to contain a stolen
 * API key; if the key itself could edit the list, the thief's first request
 * would be "add my address". Managing it requires the dashboard session — the
 * same trust level that can already reveal and rotate the webhook secret.
 *
 * PUT replaces the whole list (small list, whole-value semantics — no
 * add/remove races). Every entry is validated; one typo rejects the request
 * rather than silently never matching at request time. An empty list switches
 * the restriction off.
 */

const MAX_ENTRIES = 50

async function requireSession() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('partner_session')?.value
  if (!sessionToken) return null
  return verifyPartnerSession(sessionToken)
}

export async function GET() {
  const partner = await requireSession()
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { db } = getDb()
  try {
    const [row] = await db
      .select({ list: partners.apiIpAllowlist })
      .from(partners)
      .where(eq(partners.id, partner.id))
      .limit(1)
    return NextResponse.json({ allowlist: row?.list ?? [], enforced: (row?.list?.length ?? 0) > 0 })
  } catch (err) {
    if (!isMissingSchemaObject(err)) throw err
    return NextResponse.json({ allowlist: [], enforced: false, note: 'Not yet provisioned on this environment.' })
  }
}

export async function PUT(request: Request) {
  const partner = await requireSession()
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { allowlist?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.allowlist)) {
    return NextResponse.json(
      { error: 'allowlist must be an array of IP addresses or IPv4 CIDR blocks (empty array switches the restriction off).' },
      { status: 400 }
    )
  }
  if (body.allowlist.length > MAX_ENTRIES) {
    return NextResponse.json({ error: `At most ${MAX_ENTRIES} entries.` }, { status: 400 })
  }

  const cleaned: string[] = []
  for (const raw of body.allowlist) {
    if (typeof raw !== 'string') {
      return NextResponse.json({ error: 'Every entry must be a string.' }, { status: 400 })
    }
    const entry = parseAllowlistEntry(raw)
    if (!entry) {
      // Name the bad entry: a typo here would otherwise become a lockout that
      // only manifests as refused production requests later.
      return NextResponse.json(
        { error: `'${raw.trim()}' is not a valid IP address or IPv4 CIDR block (e.g. 41.59.226.10 or 41.59.226.0/24).`, code: 'invalid_entry' },
        { status: 400 }
      )
    }
    const display = entry.kind === 'ip' ? entry.value : entry.display
    if (!cleaned.includes(display)) cleaned.push(display)
  }

  const { db } = getDb()
  try {
    await db
      .update(partners)
      .set({ apiIpAllowlist: cleaned, updatedAt: new Date() })
      .where(eq(partners.id, partner.id))
  } catch (err) {
    if (!isMissingSchemaObject(err)) throw err
    return NextResponse.json(
      { error: 'IP allowlisting is not provisioned on this environment yet.', code: 'not_provisioned' },
      { status: 503 }
    )
  }

  await writeAuditLog('partner.ip_allowlist.updated', 'partner', partner.id, {
    entries: cleaned,
    enforced: cleaned.length > 0,
  })

  return NextResponse.json({
    success: true,
    allowlist: cleaned,
    enforced: cleaned.length > 0,
    message:
      cleaned.length > 0
        ? 'Allowlist saved. API requests with your key are now refused from any other address — make sure every production egress IP is on the list before relying on it.'
        : 'Allowlist cleared. Your API key works from any address again.',
  })
}
