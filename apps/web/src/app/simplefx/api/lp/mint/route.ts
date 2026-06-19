import crypto from 'crypto'
import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpAccounts, users, wallets, depositRequests } from '@ntzs/db'
import { initiatePayment, isValidTanzanianPhone } from '@/lib/psp'
import { getDb } from '@/lib/db'
import { withIdempotency, getIdempotencyKey } from '@/lib/idempotency'

const PRODUCTION_URL = 'https://www.ntzs.co.tz'

const MIN_DEPOSIT_TZS = 500
// Upper bound on a single M-Pesa-initiated LP deposit (fat-finger / abuse guard).
// Override per-environment with FX_LP_MAX_DEPOSIT_TZS; default 10,000,000 TZS.
const MAX_DEPOSIT_TZS = Number(process.env.FX_LP_MAX_DEPOSIT_TZS ?? 10_000_000)

function getWebhookBase(): string {
  return process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || PRODUCTION_URL
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let amountTzs: number, phoneNumber: string
  try {
    const body = await req.json()
    amountTzs = body.amountTzs
    phoneNumber = body.phoneNumber
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!amountTzs || !phoneNumber) {
    return NextResponse.json({ error: 'amountTzs and phoneNumber are required' }, { status: 400 })
  }

  if (!Number.isFinite(amountTzs) || amountTzs < MIN_DEPOSIT_TZS) {
    return NextResponse.json({ error: `Minimum deposit is ${MIN_DEPOSIT_TZS.toLocaleString()} TZS` }, { status: 400 })
  }

  if (amountTzs > MAX_DEPOSIT_TZS) {
    return NextResponse.json({ error: `Maximum deposit is ${MAX_DEPOSIT_TZS.toLocaleString()} TZS` }, { status: 400 })
  }

  if (!isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json({ error: 'Invalid Tanzanian phone number' }, { status: 400 })
  }

  // Idempotent: a double-submit carrying the same Idempotency-Key replays the first
  // response instead of creating a second deposit and a second M-Pesa prompt.
  return withIdempotency(`lp_mint:${session.lpId}`, getIdempotencyKey(req), () =>
    runMint({ lpId: session.lpId, amountTzs, phoneNumber }),
  )
}

async function runMint({
  lpId,
  amountTzs,
  phoneNumber,
}: {
  lpId: string
  amountTzs: number
  phoneNumber: string
}): Promise<NextResponse> {
  const [lp] = await db
    .select({ walletAddress: lpAccounts.walletAddress, email: lpAccounts.email })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, lpId))
    .limit(1)

  if (!lp) return NextResponse.json({ error: 'LP account not found' }, { status: 404 })

  const { db: mainDb, sql } = getDb()

  // Resolve or create a synthetic LP user record in the main DB
  const syntheticNeonId = `lp_${lp.walletAddress.toLowerCase()}`

  let [lpUser] = await mainDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.neonAuthUserId, syntheticNeonId))
    .limit(1)

  if (!lpUser) {
    const [created] = await mainDb
      .insert(users)
      .values({ neonAuthUserId: syntheticNeonId, email: lp.email, role: 'end_user' })
      .onConflictDoNothing()
      .returning({ id: users.id })

    if (!created) {
      const [refetch] = await mainDb.select({ id: users.id }).from(users).where(eq(users.neonAuthUserId, syntheticNeonId)).limit(1)
      if (!refetch) return NextResponse.json({ error: 'Failed to resolve LP user' }, { status: 500 })
      lpUser = refetch
    } else {
      lpUser = created
    }
  }

  // Resolve or create wallet record
  let [lpWallet] = await mainDb
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, lpUser.id), eq(wallets.chain, 'base')))
    .limit(1)

  if (!lpWallet) {
    const [created] = await mainDb
      .insert(wallets)
      .values({ userId: lpUser.id, chain: 'base', address: lp.walletAddress, provider: 'external' })
      .onConflictDoNothing()
      .returning({ id: wallets.id })

    if (!created) {
      const [refetch] = await mainDb.select({ id: wallets.id }).from(wallets).where(and(eq(wallets.userId, lpUser.id), eq(wallets.chain, 'base'))).limit(1)
      if (!refetch) return NextResponse.json({ error: 'Failed to resolve LP wallet' }, { status: 500 })
      lpWallet = refetch
    } else {
      lpWallet = created
    }
  }

  // Resolve or create sentinel bank
  const bankRows = await sql<{ id: string }[]>`
    insert into banks (name, status) values ('SimpleFX LP', 'active')
    on conflict (name) do update set status = 'active'
    returning id
  `
  const bankId = bankRows[0]?.id
  if (!bankId) return NextResponse.json({ error: 'Failed to resolve bank' }, { status: 500 })

  const idempotencyKey = crypto.randomUUID()

  const [deposit] = await mainDb
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

  const webhookUrl = `${getWebhookBase()}/api/webhooks/snippe/payment`

  const snippeResult = await initiatePayment({
    amountTzs,
    phoneNumber,
    customerEmail: lp.email,
    webhookUrl,
    metadata: { deposit_request_id: deposit.id },
  })

  if (!snippeResult.success) {
    await mainDb
      .update(depositRequests)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(depositRequests.id, deposit.id))

    return NextResponse.json(
      { error: snippeResult.error || 'Failed to initiate M-Pesa payment' },
      { status: 502 }
    )
  }

  await mainDb
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
