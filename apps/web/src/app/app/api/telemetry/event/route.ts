import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole, requireDbUser } from '@/lib/auth/rbac'
import { writeAuditLog } from '@/lib/audit'

export async function POST(req: NextRequest) {
  try {
    // Best-effort auth to attribute actor when possible
    try { await requireAnyRole(['end_user', 'super_admin']) } catch {}
    let userId: string | null = null
    try { const u = await requireDbUser(); userId = u.id } catch {}

    const json = await req.json().catch(() => ({}))
    const event = String(json.event || 'ui_event')
    const payload = (json.payload && typeof json.payload === 'object') ? json.payload as Record<string, unknown> : {}

    // Fire-and-forget audit write
    await writeAuditLog(event, 'ui', 'ui', payload, userId)

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return NextResponse.json({ ok: false }, { status: 200 }) // never fail the page due to telemetry
  }
}
