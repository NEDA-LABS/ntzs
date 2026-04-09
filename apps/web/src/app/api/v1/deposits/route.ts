import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { initiatePayment, initiateCardPayment, isValidTanzanianPhone } from '@/lib/psp/snippe'
import { users, wallets, partnerUsers, depositRequests, partners } from '@ntzs/db'

type PaymentMethod = 'mobile_money' | 'card'

interface DepositBody {
  userId: string
  amountTzs: number
  paymentMethod?: PaymentMethod
  // mobile_money
  phoneNumber?: string
  // card
  redirectUrl?: string
  cancelUrl?: string
  /**
   * When true, nTZS is minted directly to the partner's treasury wallet instead
   * of the individual user's wallet. Use this for payment-collection use cases
   * where you are collecting funds on behalf of your platform rather than
   * crediting end-user wallets. Requires the partner treasury to be provisioned.
   */
  collectToTreasury?: boolean
}

/**
 * POST /api/v1/deposits — Initiate a deposit (on-ramp)
 *
 * paymentMethod: "mobile_money" (default) | "card"
 *
 * mobile_money: requires phoneNumber. Sends a push prompt to the user's phone.
 *   Response: { id, status, amountTzs, paymentMethod, instructions }
 *
 * card: requires redirectUrl and cancelUrl. Returns a hosted payment page URL.
 *   Response: { id, status, amountTzs, paymentMethod, paymentUrl }
 *   Redirect your user to paymentUrl to complete card payment. On completion,
 *   Snippe fires a webhook and nTZS is minted automatically.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult

  let body: DepositBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { userId, amountTzs, paymentMethod = 'mobile_money', phoneNumber, redirectUrl, cancelUrl, collectToTreasury = false } = body

  if (!userId || !amountTzs) {
    return NextResponse.json(
      { error: 'userId and amountTzs are required' },
      { status: 400 }
    )
  }

  if (amountTzs < 500) {
    return NextResponse.json(
      { error: 'Minimum deposit amount is 500 TZS' },
      { status: 400 }
    )
  }

  if (paymentMethod !== 'mobile_money' && paymentMethod !== 'card') {
    return NextResponse.json(
      { error: 'paymentMethod must be "mobile_money" or "card"' },
      { status: 400 }
    )
  }

  // Method-specific validation
  if (paymentMethod === 'mobile_money') {
    if (!phoneNumber) {
      return NextResponse.json(
        { error: 'phoneNumber is required for mobile_money deposits' },
        { status: 400 }
      )
    }
    if (!isValidTanzanianPhone(phoneNumber)) {
      return NextResponse.json(
        { error: 'Invalid Tanzanian phone number' },
        { status: 400 }
      )
    }
  }

  if (paymentMethod === 'card') {
    if (!redirectUrl || !cancelUrl) {
      return NextResponse.json(
        { error: 'redirectUrl and cancelUrl are required for card deposits' },
        { status: 400 }
      )
    }
    if (!redirectUrl.startsWith('https://') || !cancelUrl.startsWith('https://')) {
      return NextResponse.json(
        { error: 'redirectUrl and cancelUrl must be HTTPS URLs' },
        { status: 400 }
      )
    }
  }

  const { db } = getDb()

  // Verify user belongs to this partner
  const [mapping] = await db
    .select({ externalId: partnerUsers.externalId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, userId)))
    .limit(1)

  if (!mapping) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Get user and wallet
  const [user] = await db
    .select({ id: users.id, email: users.email, bankId: users.bankId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // ── Resolve deposit destination wallet ────────────────────────────────────
  // collectToTreasury=true  → mint to partner treasury (payment-collection mode)
  // collectToTreasury=false → mint to the user's own wallet (WaaS mode, default)
  let walletId: string

  if (collectToTreasury) {
    // Fetch partner treasury address
    const [partnerRow] = await db
      .select({ treasuryWalletAddress: partners.treasuryWalletAddress, name: partners.name, email: partners.email })
      .from(partners)
      .where(eq(partners.id, partner.id))
      .limit(1)

    if (!partnerRow?.treasuryWalletAddress) {
      return NextResponse.json(
        { error: 'Partner treasury wallet not provisioned. Set up your treasury before using collectToTreasury.' },
        { status: 400 }
      )
    }

    // Resolve or create the synthetic treasury user + wallet record
    const treasuryNeonId = `treasury_${partner.id}`
    let [treasuryUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.neonAuthUserId, treasuryNeonId))
      .limit(1)

    if (!treasuryUser) {
      const partnerEmail = partnerRow.email ?? `treasury+${partner.id}@waas.internal`
      const partnerName = partnerRow.name ?? 'Partner'
      const [created] = await db
        .insert(users)
        .values({ neonAuthUserId: treasuryNeonId, email: partnerEmail, name: `${partnerName} Treasury`, role: 'end_user' })
        .onConflictDoNothing()
        .returning({ id: users.id })
      if (!created) {
        const [refetch] = await db.select({ id: users.id }).from(users).where(eq(users.neonAuthUserId, treasuryNeonId)).limit(1)
        if (!refetch) return NextResponse.json({ error: 'Failed to resolve treasury account' }, { status: 500 })
        treasuryUser = refetch
      } else {
        treasuryUser = created
      }
    }

    // Resolve or create treasury wallet record
    let [treasuryWallet] = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(and(eq(wallets.userId, treasuryUser.id), eq(wallets.chain, 'base')))
      .limit(1)

    if (!treasuryWallet) {
      const [created] = await db
        .insert(wallets)
        .values({ userId: treasuryUser.id, chain: 'base', address: partnerRow.treasuryWalletAddress, provider: 'external' })
        .onConflictDoNothing()
        .returning({ id: wallets.id })
      if (!created) {
        const [refetch] = await db.select({ id: wallets.id }).from(wallets).where(and(eq(wallets.userId, treasuryUser.id), eq(wallets.chain, 'base'))).limit(1)
        if (!refetch) return NextResponse.json({ error: 'Failed to resolve treasury wallet record' }, { status: 500 })
        treasuryWallet = refetch
      } else {
        treasuryWallet = created
      }
    }

    walletId = treasuryWallet.id
  } else {
    // Standard WaaS mode: user must have their own wallet
    const [userWallet] = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
      .limit(1)

    if (!userWallet) {
      return NextResponse.json(
        { error: 'User has no wallet. Create the user first via POST /api/v1/partners/users, or pass collectToTreasury: true to collect funds directly to your treasury wallet.' },
        { status: 400 }
      )
    }

    walletId = userWallet.id
  }

  // Generate idempotency key for this deposit
  const idempotencyKey = crypto.randomUUID()

  // We need a bankId for deposit_requests — use a default "WaaS" bank or the user's bank
  // For WaaS deposits, bankId is required by schema. We'll use a sentinel value.
  // TODO: Create a default WaaS bank entry during setup
  let bankId = user.bankId
  if (!bankId) {
    // Look up or create a default WaaS bank
    const { sql } = getDb()
    const bankRows = await sql<{ id: string }[]>`
      insert into banks (name, status) values ('WaaS Default', 'active')
      on conflict (name) do update set status = 'active'
      returning id
    `
    bankId = bankRows[0]?.id
    if (!bankId) {
      return NextResponse.json({ error: 'Failed to resolve bank for deposit' }, { status: 500 })
    }
  }

  const apiBaseUrl = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.ntzs.co.tz'
  const webhookUrl = `${apiBaseUrl}/api/webhooks/snippe/payment`

  // ── Mobile money ───────────────────────────────────────────────────────────
  if (paymentMethod === 'mobile_money') {
    const [deposit] = await db
      .insert(depositRequests)
      .values({
        userId,
        bankId,
        walletId,
        chain: 'base',
        amountTzs,
        status: 'submitted',
        idempotencyKey,
        partnerId: partner.id,
        paymentProvider: 'snippe',
        buyerPhone: phoneNumber,
      })
      .returning({
        id: depositRequests.id,
        status: depositRequests.status,
        amountTzs: depositRequests.amountTzs,
      })

    if (!deposit) {
      return NextResponse.json({ error: 'Failed to create deposit request' }, { status: 500 })
    }

    const snippeResult = await initiatePayment({
      amountTzs,
      phoneNumber: phoneNumber!,
      customerEmail: user.email,
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
        paymentMethod: 'mobile_money',
        instructions: 'Check your phone for the M-Pesa payment prompt',
      },
      { status: 201 }
    )
  }

  // ── Card ───────────────────────────────────────────────────────────────────
  const [deposit] = await db
    .insert(depositRequests)
    .values({
      userId,
      bankId,
      walletId,
      chain: 'base',
      amountTzs,
      status: 'submitted',
      idempotencyKey,
      partnerId: partner.id,
      paymentProvider: 'snippe_card',
    })
    .returning({
      id: depositRequests.id,
      status: depositRequests.status,
      amountTzs: depositRequests.amountTzs,
    })

  if (!deposit) {
    return NextResponse.json({ error: 'Failed to create deposit request' }, { status: 500 })
  }

  const cardResult = await initiateCardPayment({
    amountTzs,
    phoneNumber: '',
    customerEmail: user.email,
    redirectUrl: redirectUrl!,
    cancelUrl: cancelUrl!,
    webhookUrl,
    metadata: { deposit_request_id: deposit.id },
  })

  if (!cardResult.success) {
    await db
      .update(depositRequests)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(depositRequests.id, deposit.id))

    return NextResponse.json(
      { error: cardResult.error || 'Failed to initiate card payment' },
      { status: 502 }
    )
  }

  await db
    .update(depositRequests)
    .set({ pspReference: cardResult.reference, updatedAt: new Date() })
    .where(eq(depositRequests.id, deposit.id))

  return NextResponse.json(
    {
      id: deposit.id,
      status: 'submitted',
      amountTzs: deposit.amountTzs,
      paymentMethod: 'card',
      paymentUrl: cardResult.paymentUrl,
    },
    { status: 201 }
  )
}
