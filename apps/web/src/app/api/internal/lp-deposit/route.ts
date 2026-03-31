/**
 * POST /api/internal/lp-deposit
 *
 * Internal endpoint used by apps/fx to initiate an nTZS mint deposit
 * directly to an LP's inventory wallet via the Snippe M-Pesa rails.
 *
 * Auth: Authorization: Bearer INTERNAL_API_SECRET
 * Body: { walletAddress, amountTzs, phoneNumber, lpEmail }
 */
import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

import { getDb } from '@/lib/db'
import { initiatePayment, isValidTanzanianPhone } from '@/lib/psp/snippe'
import { users, wallets, depositRequests } from '@ntzs/db'

function verifySecret(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function POST(request: NextRequest) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { walletAddress: string; amountTzs: number; phoneNumber: string; lpEmail: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { walletAddress, amountTzs, phoneNumber, lpEmail } = body

  if (!walletAddress || !amountTzs || !phoneNumber || !lpEmail) {
    return NextResponse.json({ error: 'walletAddress, amountTzs, phoneNumber and lpEmail are required' }, { status: 400 })
  }

  if (amountTzs < 500) {
    return NextResponse.json({ error: 'Minimum deposit is 500 TZS' }, { status: 400 })
  }

  if (!isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })
  }

  const { db, sql } = getDb()

  // Resolve or create a synthetic LP user record
  const syntheticNeonId = `lp_${walletAddress.toLowerCase()}`

  let [lpUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.neonAuthUserId, syntheticNeonId))
    .limit(1)

  if (!lpUser) {
    const [created] = await db
      .insert(users)
      .values({ neonAuthUserId: syntheticNeonId, email: lpEmail, role: 'end_user' })
      .onConflictDoNothing()
      .returning({ id: users.id })

    if (!created) {
      const [refetch] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.neonAuthUserId, syntheticNeonId))
        .limit(1)
      if (!refetch) return NextResponse.json({ error: 'Failed to resolve LP user' }, { status: 500 })
      lpUser = refetch
    } else {
      lpUser = created
    }
  }

  // Resolve or create wallet record for this LP address
  let [lpWallet] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, lpUser.id), eq(wallets.chain, 'base')))
    .limit(1)

  if (!lpWallet) {
    const [created] = await db
      .insert(wallets)
      .values({ userId: lpUser.id, chain: 'base', address: walletAddress, provider: 'external' })
      .onConflictDoNothing()
      .returning({ id: wallets.id })

    if (!created) {
      const [refetch] = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(and(eq(wallets.userId, lpUser.id), eq(wallets.chain, 'base')))
        .limit(1)
      if (!refetch) return NextResponse.json({ error: 'Failed to resolve LP wallet' }, { status: 500 })
      lpWallet = refetch
    } else {
      lpWallet = created
    }
  }

  // Resolve or create sentinel bank for LP deposits
  const bankRows = await sql<{ id: string }[]>`
    insert into banks (name, status) values ('SimpleFX LP', 'active')
    on conflict (name) do update set status = 'active'
    returning id
  `
  const bankId = bankRows[0]?.id
  if (!bankId) return NextResponse.json({ error: 'Failed to resolve bank' }, { status: 500 })

  const idempotencyKey = crypto.randomUUID()

  const [deposit] = await db
    .insert(depositRequests)
    .values({
      userId: lpUser.id,
      bankId,
      walletId: lpWallet.id,
      chain: 'base',
      amountTzs,
      status: 'submitted',
      idempotencyKey,
      paymentProvider: 'snippe',
      buyerPhone: phoneNumber,
      source: 'self',
    })
    .returning({ id: depositRequests.id })

  if (!deposit) {
    return NextResponse.json({ error: 'Failed to create deposit request' }, { status: 500 })
  }

  const apiBaseUrl = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  const webhookUrl = `${apiBaseUrl}/api/webhooks/snippe/payment`

  const snippeResult = await initiatePayment({
    amountTzs,
    phoneNumber,
    customerEmail: lpEmail,
    webhookUrl,
    metadata: { deposit_request_id: deposit.id },
  })

  if (!snippeResult.success) {
    await db
      .update(depositRequests)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(depositRequests.id, deposit.id))

    return NextResponse.json(
      { error: snippeResult.error || 'Failed to initiate M-Pesa payment' },
      { status: 502 }
    )
  }

  await db
    .update(depositRequests)
    .set({ pspReference: snippeResult.reference, updatedAt: new Date() })
    .where(eq(depositRequests.id, deposit.id))

  return NextResponse.json({
    depositId: deposit.id,
    status: 'submitted',
    amountTzs,
    instructions: 'Check your phone for the M-Pesa payment prompt',
  }, { status: 201 })
}
