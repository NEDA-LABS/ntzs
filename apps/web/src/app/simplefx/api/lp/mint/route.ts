import crypto from 'crypto'
import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpAccounts, users, wallets, depositRequests } from '@ntzs/db'
import { initiatePayment, isValidTanzanianPhone } from '@/lib/psp'
import { BANK_CHANNEL, formatBankReference, normalizeAccountNumber } from '@/lib/psp/selcom-statement'
import { getBankCollectionConfig } from '@/lib/psp/selcom-w2b'
import { allocateBankReference, bankTransferInstructions } from '@/lib/deposits/bank-collection'
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

  let amountTzs: number, phoneNumber: string, method: string, payerAccountNumber: string
  try {
    const body = await req.json()
    amountTzs = body.amountTzs
    phoneNumber = body.phoneNumber
    method = body.method ?? 'mobile_money'
    payerAccountNumber = String(body.payerAccountNumber ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (method !== 'mobile_money' && method !== 'bank_transfer') {
    return NextResponse.json({ error: 'method must be "mobile_money" or "bank_transfer"' }, { status: 400 })
  }

  if (!Number.isFinite(amountTzs) || amountTzs < MIN_DEPOSIT_TZS) {
    return NextResponse.json({ error: `Minimum deposit is ${MIN_DEPOSIT_TZS.toLocaleString()} TZS` }, { status: 400 })
  }

  if (amountTzs > MAX_DEPOSIT_TZS) {
    return NextResponse.json({ error: `Maximum deposit is ${MAX_DEPOSIT_TZS.toLocaleString()} TZS` }, { status: 400 })
  }

  // Bank transfer carries no phone. The reference token is often stripped in
  // transit too, so the account the payer sends FROM is what actually
  // identifies the credit — required, not optional.
  if (method === 'bank_transfer') {
    const account = normalizeAccountNumber(payerAccountNumber)
    if (!account) {
      return NextResponse.json(
        { error: 'payerAccountNumber is required for a bank transfer — it is how your payment is identified when it arrives' },
        { status: 400 },
      )
    }
    return withIdempotency(`lp_mint:${session.lpId}`, getIdempotencyKey(req), () =>
      runBankIntent({ lpId: session.lpId, amountTzs, payerAccountNumber: account }),
    )
  }

  if (!phoneNumber) {
    return NextResponse.json({ error: 'phoneNumber is required for mobile money' }, { status: 400 })
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

/**
 * Create a bank-transfer funding intent (banking phase 3 rail).
 *
 * No push and no PSP call: the row carries a generated reference token in
 * pspReference, and `selcom-statement-sync` matches the incoming credit by
 * that token + exact amount, then advances it to mint. Bank credits carry no
 * payer phone, which is why the token — not a phone — is the identity.
 */
async function runBankIntent({
  lpId,
  amountTzs,
  payerAccountNumber,
}: {
  lpId: string
  amountTzs: number
  payerAccountNumber: string
}): Promise<NextResponse> {
  const cfg = getBankCollectionConfig()
  if (!cfg) {
    return NextResponse.json({ error: 'Bank transfer deposits are not enabled on this environment yet.' }, { status: 503 })
  }

  const ctx = await resolveLpDepositContext(lpId)
  if ('error' in ctx) return ctx.error
  const { mainDb, lpUser, lpWallet, bankId } = ctx

  const reference = await allocateBankReference(mainDb)

  const [deposit] = await mainDb
    .insert(depositRequests)
    .values({
      userId: lpUser.id,
      bankId,
      walletId: lpWallet.id,
      chain: 'base',
      amountTzs,
      status: 'submitted',
      idempotencyKey: crypto.randomUUID(),
      paymentProvider: 'selcom',
      pspChannel: BANK_CHANNEL,
      pspReference: reference,
      payerAccountNumber,
      source: 'self',
    })
    .returning({ id: depositRequests.id })

  if (!deposit) {
    return NextResponse.json({ error: 'Failed to create deposit request' }, { status: 500 })
  }

  return NextResponse.json(
    {
      depositId: deposit.id,
      status: 'submitted',
      amountTzs,
      method: 'bank_transfer',
      reference: formatBankReference(reference),
      instructions: bankTransferInstructions(cfg, reference, amountTzs),
    },
    { status: 201 },
  )
}

/**
 * Resolve the main-DB records a deposit needs for this LP — a synthetic user,
 * its wallet, and the sentinel bank — so every funding method lands against
 * exactly the same identity.
 */
async function resolveLpDepositContext(lpId: string): Promise<
  | { error: NextResponse }
  | {
      lp: { walletAddress: string; email: string }
      lpUser: { id: string }
      lpWallet: { id: string }
      bankId: string
      mainDb: ReturnType<typeof getDb>['db']
    }
> {
  const [lp] = await db
    .select({ walletAddress: lpAccounts.walletAddress, email: lpAccounts.email })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, lpId))
    .limit(1)

  if (!lp) return { error: NextResponse.json({ error: 'LP account not found' }, { status: 404 }) }

  const { db: mainDb, sql } = getDb()

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
      if (!refetch) return { error: NextResponse.json({ error: 'Failed to resolve LP user' }, { status: 500 }) }
      lpUser = refetch
    } else {
      lpUser = created
    }
  }

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
      if (!refetch) return { error: NextResponse.json({ error: 'Failed to resolve LP wallet' }, { status: 500 }) }
      lpWallet = refetch
    } else {
      lpWallet = created
    }
  }

  const bankRows = await sql<{ id: string }[]>`
    insert into banks (name, status) values ('SimpleFX LP', 'active')
    on conflict (name) do update set status = 'active'
    returning id
  `
  const bankId = bankRows[0]?.id
  if (!bankId) return { error: NextResponse.json({ error: 'Failed to resolve bank' }, { status: 500 }) }

  return { lp, lpUser, lpWallet, bankId, mainDb }
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
