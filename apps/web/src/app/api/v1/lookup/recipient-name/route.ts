import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { isValidTanzanianPhone, lookupRecipientName, normalizePhone } from '@/lib/psp'
import { detectNetwork } from '@/lib/psp/routing'
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit'

const LOOKUPS_PER_MINUTE = 30

/**
 * POST /api/v1/lookup/recipient-name — resolve the MNO-registered name for a
 * mobile money number, so partner apps can show "Sending to: JOHN DOE" before
 * the user confirms a withdrawal.
 *
 * Fail-soft by contract: `name: null` means "no confirmation available"
 * (number not registered, enquiry service unavailable, or the capability not
 * yet enabled) — partners proceed without the name line, never block on null.
 * Powered by the disbursement-side name enquiry; lights up automatically once
 * that rail's network access is provisioned.
 *
 * Guardrails: per-partner rate limit + an audit row per lookup — this
 * endpoint resolves PII (registered names) and must not be usable for bulk
 * phone-book enumeration.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult

  try {
    await enforceRateLimit(`namelookup:${partner.id}`, LOOKUPS_PER_MINUTE, 60)
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Too many lookups — slow down and retry shortly.' },
        { status: 429, headers: { 'Retry-After': String(err.retryAfterSec) } }
      )
    }
    throw err
  }

  let body: { phoneNumber?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : ''
  if (!phoneNumber || !isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json(
      { error: 'phoneNumber must be a valid Tanzanian mobile number', code: 'invalid_phone' },
      { status: 400 }
    )
  }

  const phone = normalizePhone(phoneNumber)
  const network = detectNetwork(phone)
  // idNumber from the enquiry is deliberately NOT exposed to partners.
  const { name } = await lookupRecipientName(phone).catch(() => ({ name: null as string | null }))

  try {
    const { sql } = getDb()
    await sql`
      insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
      values ('partner.name_lookup', 'partner', ${partner.id}, ${JSON.stringify({
        phone,
        network,
        found: Boolean(name),
      })}::jsonb, now())
    `
  } catch (err) {
    console.warn('[v1/lookup] audit insert failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ phone, network, name })
}
