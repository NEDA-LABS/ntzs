import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { requireAnyRole } from '@/lib/auth/rbac'
import { partners } from '@ntzs/db'
import { ALL_CAPABILITIES, CAPABILITY_PRESETS, CAPABILITIES, type Capability } from '@/lib/platform/capabilities'

/**
 * GET  /api/backstage/partners/[id]/capabilities — current + the full catalog/presets.
 * POST /api/backstage/partners/[id]/capabilities — set a partner's capabilities.
 *   Body: { capabilities: Capability[] }  OR  { preset: keyof CAPABILITY_PRESETS }
 *   `capabilities: null` clears it (→ legacy/full-access behaviour).
 *
 * Super-admin only.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAnyRole(['super_admin']) } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  const { db } = getDb()
  const [p] = await db.select({ capabilities: partners.capabilities }).from(partners).where(eq(partners.id, id)).limit(1)
  if (!p) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  return NextResponse.json({
    capabilities: p.capabilities,
    catalog: ALL_CAPABILITIES.map((c) => ({ id: c, label: CAPABILITIES[c].label, kybRequired: CAPABILITIES[c].kybRequired })),
    presets: Object.fromEntries(Object.entries(CAPABILITY_PRESETS).map(([k, v]) => [k, v.capabilities])),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAnyRole(['super_admin']) } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  let body: { capabilities?: string[] | null; preset?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  let next: Capability[] | null
  if (body.preset !== undefined) {
    const preset = CAPABILITY_PRESETS[body.preset]
    if (!preset) return NextResponse.json({ error: `Unknown preset. Valid: ${Object.keys(CAPABILITY_PRESETS).join(', ')}` }, { status: 400 })
    next = preset.capabilities
  } else if (body.capabilities === null) {
    next = null // clear → legacy full-access
  } else if (Array.isArray(body.capabilities)) {
    const invalid = body.capabilities.filter((c) => !(c in CAPABILITIES))
    if (invalid.length) return NextResponse.json({ error: `Invalid capabilities: ${invalid.join(', ')}` }, { status: 400 })
    next = body.capabilities as Capability[]
  } else {
    return NextResponse.json({ error: 'Provide { capabilities: [...] | null } or { preset }' }, { status: 400 })
  }

  const { db } = getDb()
  const [updated] = await db
    .update(partners)
    .set({ capabilities: next, updatedAt: new Date() })
    .where(eq(partners.id, id))
    .returning({ id: partners.id, capabilities: partners.capabilities })
  if (!updated) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  return NextResponse.json({ ok: true, partnerId: updated.id, capabilities: updated.capabilities })
}
