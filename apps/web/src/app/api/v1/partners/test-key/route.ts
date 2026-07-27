import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/audit'
import { verifyPartnerSession } from '@/lib/waas/auth'
import { createTestPartner, findPairedTestPartner, rotateTestKey } from '@/lib/testmode/provisioning'

/**
 * Test keys for an existing (live) partner.
 *
 * GET  → does this account have a sandbox key, and what is its prefix?
 * POST → issue one, or rotate it if it already exists.
 *
 * The sandbox is a SEPARATE partner row paired to the live account, not a flag
 * on it: live and test data never share a table row, a wallet index, or a
 * balance. Rotating a test key cannot affect the live key, and vice versa.
 */
async function requireSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get('partner_session')?.value
  if (!token) return null
  return verifyPartnerSession(token)
}

export async function GET() {
  const partner = await requireSession()
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (partner.mode === 'test') {
    return NextResponse.json({ isTestAccount: true, message: 'You are signed in with a sandbox account.' })
  }

  const paired = await findPairedTestPartner(partner.id)
  if (paired === 'migration_pending') {
    return NextResponse.json({ available: false, reason: 'migration_pending' })
  }

  return NextResponse.json({
    available: true,
    hasTestKey: Boolean(paired),
    testPartnerId: paired?.id ?? null,
    apiKeyPrefix: paired?.apiKeyPrefix ?? null,
  })
}

export async function POST() {
  const partner = await requireSession()
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (partner.mode === 'test') {
    return NextResponse.json(
      { error: 'already_test', message: 'This account is already a sandbox account.' },
      { status: 400 }
    )
  }

  const paired = await findPairedTestPartner(partner.id)
  if (paired === 'migration_pending') {
    return NextResponse.json(
      { error: 'migration_pending', message: 'Test mode is not available on this deployment yet.' },
      { status: 503 }
    )
  }

  if (paired) {
    const { apiKey } = await rotateTestKey(paired.id)
    await writeAuditLog('testmode.key_rotated', 'partner', paired.id, { livePartnerId: partner.id })
    return NextResponse.json({
      apiKey,
      apiKeyPrefix: apiKey.slice(0, 14),
      rotated: true,
      message: 'New test key issued — the previous one no longer works. Save it now; it is not shown again.',
    })
  }

  const result = await createTestPartner({
    name: `${partner.name} (Sandbox)`,
    // Namespaced so it can never collide with a real signup email.
    email: `sandbox+${partner.id}@testmode.ntzs.local`,
    webhookUrl: partner.webhookUrl,
    livePartnerId: partner.id,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.code, message: result.message }, { status: 503 })
  }

  await writeAuditLog('testmode.partner_created', 'partner', result.partnerId, {
    livePartnerId: partner.id,
    source: 'dashboard',
  })

  return NextResponse.json({
    apiKey: result.apiKey,
    apiKeyPrefix: result.apiKey.slice(0, 14),
    webhookSecret: result.webhookSecret,
    rotated: false,
    message: 'Test key created. Save it now — it is not shown again. Start with GET /api/v1/testmode.',
  })
}
