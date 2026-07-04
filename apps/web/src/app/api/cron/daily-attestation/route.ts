import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'

import { generateDailyAttestation } from '@/lib/attestation'

export const maxDuration = 60

/**
 * GET /api/cron/daily-attestation
 *
 * Runs daily at 10:00 EAT (07:00 UTC). Produces, archives, and emails the BoT
 * daily reserve attestation (sandbox Parameter 7 + 16): nTZS in circulation vs
 * the ring-fenced TZS reserve and the deviation from 1:1. Idempotent per EAT day.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await generateDailyAttestation()
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Attestation failed'
    console.error('[daily-attestation] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
