import { NextResponse } from 'next/server'

import { requireAnyRole } from '@/lib/auth/rbac'
import { computeAttestation, generateDailyAttestation } from '@/lib/attestation'

export const dynamic = 'force-dynamic'

/** GET — preview today's attestation figures without persisting or emailing. */
export async function GET() {
  await requireAnyRole(['platform_compliance', 'super_admin'])
  const report = await computeAttestation()
  return NextResponse.json({ ok: true, preview: true, report })
}

/** POST — generate, archive, and email the attestation now (same as the 10:00 cron). */
export async function POST() {
  await requireAnyRole(['platform_compliance', 'super_admin'])
  const report = await generateDailyAttestation()
  return NextResponse.json({ ok: true, report })
}
