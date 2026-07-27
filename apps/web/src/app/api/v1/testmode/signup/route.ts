import { NextRequest, NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/audit'
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit'
import { testModeSignupEnabled } from '@/lib/testmode'
import { createTestPartner } from '@/lib/testmode/provisioning'

/**
 * POST /api/v1/testmode/signup — self-serve sandbox credentials.
 *
 * The point of this endpoint is that there is NO gate in front of the first
 * API call: a developer (or a bank's engineer sitting in a meeting) can have
 * working credentials in seconds, with no contract, no sales call and no
 * account review. That is the difference between a sandbox and a brochure.
 *
 * It is safe to leave open because it can only ever mint a mode='test'
 * partner: no HD seed, no treasury, no access to chain, PSP or reserve. The
 * only abuse surface is table rows, which the per-IP limit and the daily cap
 * bound.
 *
 * Body: { name, email, webhookUrl? } → { apiKey, webhookSecret } (once).
 */
export async function POST(request: NextRequest) {
  if (!testModeSignupEnabled()) {
    return NextResponse.json(
      {
        error: 'signup_disabled',
        message: 'Self-serve sandbox signup is closed on this deployment. Contact us for a test key.',
      },
      { status: 503 }
    )
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  try {
    await enforceRateLimit(`testmode-signup:${ip}`, 3, 3600)
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many sandbox signups from this address. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(err.retryAfterSec) } }
      )
    }
    throw err
  }

  let body: { name?: unknown; email?: unknown; webhookUrl?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const webhookUrl = typeof body.webhookUrl === 'string' && body.webhookUrl.trim() ? body.webhookUrl.trim() : null

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email are required' }, { status: 400 })
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
  }
  if (webhookUrl && !/^https:\/\//i.test(webhookUrl)) {
    return NextResponse.json({ error: 'webhookUrl must be https' }, { status: 400 })
  }

  const result = await createTestPartner({
    name: `${name} (Sandbox)`,
    email,
    webhookUrl,
    enforceDailyCap: true,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, message: result.message },
      { status: result.code === 'exists' ? 409 : 503 }
    )
  }

  await writeAuditLog('testmode.partner_created', 'partner', result.partnerId, { email, source: 'self_serve' })

  return NextResponse.json(
    {
      livemode: false,
      partnerId: result.partnerId,
      apiKey: result.apiKey,
      webhookSecret: result.webhookSecret,
      message:
        'Sandbox credentials created — save them now, the key is not shown again. Start with GET /api/v1/testmode.',
      nextSteps: [
        'GET /api/v1/testmode — scenarios and controls',
        'POST /api/v1/users — create a simulated user (any 20-digit NIDA)',
        'POST /api/v1/deposits — fund it, then POST /api/v1/testmode/advance',
      ],
    },
    { status: 201 }
  )
}
