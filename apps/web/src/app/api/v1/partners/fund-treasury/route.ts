import crypto from 'crypto'
import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { initiatePayment, isValidTanzanianPhone, normalizePhone } from '@/lib/psp/snippe'
import { users, wallets, depositRequests, partners } from '@ntzs/db'

function verifySessionToken(token: string): string | null {
  const secret = process.env.APP_SECRET || 'dev-secret-do-not-use'
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, sig] = parts
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded!).digest('base64url')

  if (sig!.length !== expectedSig.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig!, 'utf8'), Buffer.from(expectedSig, 'utf8'))) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    if (payload.exp && payload.exp < Date.now()) return null
    return payload.pid || null
  } catch {
    return null
  }
}

/**
 * POST /api/v1/partners/fund-treasury
 * Initiate an M-Pesa on-ramp deposit to the partner's treasury wallet.
 * Mirrors the normal user deposit flow — Snippe webhook fires, then
 * the reconcile process mints nTZS to the treasury address.
 *
 * Auth: partner session cookie.
 * Body: { amountTzs: number; phoneNumber: string }
 */
export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cookieToken = request.cookies.get('partner_session')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = cookieToken || bearerToken

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const partnerId = verifySessionToken(token)
  if (!partnerId) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { amountTzs: number; phoneNumber: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { amountTzs, phoneNumber } = body

  if (!amountTzs || !phoneNumber) {
    return NextResponse.json({ error: 'amountTzs and phoneNumber are required' }, { status: 400 })
  }
  if (amountTzs < 500) {
    return NextResponse.json({ error: 'Minimum deposit is 500 TZS' }, { status: 400 })
  }
  if (!isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })
  }

  const { db, sql } = getDb()

  // ── Fetch partner ───────────────────────────────────────────────────────────
  const [partner] = await db
    .select({
      id: partners.id,
      name: partners.name,
      email: partners.email,
      treasuryWalletAddress: partners.treasuryWalletAddress,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }
  if (!partner.treasuryWalletAddress) {
    return NextResponse.json(
      { error: 'Treasury wallet not provisioned. Create a user wallet first.' },
      { status: 400 }
    )
  }

  // ── Resolve or create a treasury service-account user ──────────────────────
  // This synthetic user represents the partner's treasury in the deposit_requests
  // table (which requires a userId FK). The wallet record points to the treasury address.
  const treasuryNeonId = `treasury_${partnerId}`

  let [treasuryUser] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.neonAuthUserId, treasuryNeonId))
    .limit(1)

  if (!treasuryUser) {
    const partnerEmail = partner.email ?? `treasury+${partnerId}@waas.internal`
    const partnerName = partner.name ?? 'Partner'
    const [created] = await db
      .insert(users)
      .values({
        neonAuthUserId: treasuryNeonId,
        email: partnerEmail,
        name: `${partnerName} Treasury`,
        role: 'end_user',
      })
      .onConflictDoNothing()
      .returning({ id: users.id, email: users.email })

    if (!created) {
      // Race condition — fetch again
      const [refetch] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.neonAuthUserId, treasuryNeonId))
        .limit(1)
      if (!refetch) {
        return NextResponse.json({ error: 'Failed to resolve treasury account' }, { status: 500 })
      }
      treasuryUser = refetch
    } else {
      treasuryUser = created
    }
  }

  // ── Resolve or create treasury wallet record ────────────────────────────────
  let [treasuryWallet] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, treasuryUser.id), eq(wallets.chain, 'base')))
    .limit(1)

  if (!treasuryWallet) {
    const [created] = await db
      .insert(wallets)
      .values({
        userId: treasuryUser.id,
        chain: 'base',
        address: partner.treasuryWalletAddress,
        provider: 'external',
      })
      .onConflictDoNothing()
      .returning({ id: wallets.id })

    if (!created) {
      const [refetch] = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(and(eq(wallets.userId, treasuryUser.id), eq(wallets.chain, 'base')))
        .limit(1)
      if (!refetch) {
        return NextResponse.json({ error: 'Failed to resolve treasury wallet record' }, { status: 500 })
      }
      treasuryWallet = refetch
    } else {
      treasuryWallet = created
    }
  }

  // ── Resolve WaaS default bank ───────────────────────────────────────────────
  const bankRows = await sql<{ id: string }[]>`
    insert into banks (name, status) values ('WaaS Default', 'active')
    on conflict (name) do update set status = 'active'
    returning id
  `
  const bankId = bankRows[0]?.id
  if (!bankId) {
    return NextResponse.json({ error: 'Failed to resolve bank for deposit' }, { status: 500 })
  }

  // ── Create deposit request ──────────────────────────────────────────────────
  const idempotencyKey = crypto.randomUUID()
  const normalizedPhone = normalizePhone(phoneNumber)

  const [deposit] = await db
    .insert(depositRequests)
    .values({
      userId: treasuryUser.id,
      bankId,
      walletId: treasuryWallet.id,
      chain: 'base',
      amountTzs: Math.trunc(amountTzs),
      status: 'submitted',
      idempotencyKey,
      partnerId,
      paymentProvider: 'snippe',
      buyerPhone: normalizedPhone,
    })
    .returning({ id: depositRequests.id, amountTzs: depositRequests.amountTzs })

  if (!deposit) {
    return NextResponse.json({ error: 'Failed to create deposit request' }, { status: 500 })
  }

  // ── Initiate Snippe payment ─────────────────────────────────────────────────
  const apiBaseUrl = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  const webhookUrl = `${apiBaseUrl}/api/webhooks/snippe/payment`

  const snippeResult = await initiatePayment({
    amountTzs: Math.trunc(amountTzs),
    phoneNumber: normalizedPhone,
    customerEmail: partner.email ?? `treasury+${partnerId}@waas.internal`,
    customerFirstname: partner.name ?? 'Partner',
    webhookUrl,
    metadata: { deposit_request_id: deposit.id },
  })

  if (!snippeResult.success) {
    await db
      .update(depositRequests)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(depositRequests.id, deposit.id))

    return NextResponse.json(
      { error: snippeResult.error || 'Failed to initiate payment' },
      { status: 502 }
    )
  }

  await db
    .update(depositRequests)
    .set({ pspReference: snippeResult.reference, updatedAt: new Date() })
    .where(eq(depositRequests.id, deposit.id))

  return NextResponse.json(
    {
      id: deposit.id,
      status: 'submitted',
      amountTzs: deposit.amountTzs,
      instructions: 'Check your phone for the M-Pesa payment prompt',
    },
    { status: 201 }
  )
}
