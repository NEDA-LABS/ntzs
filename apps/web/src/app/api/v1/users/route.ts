import { eq, and, sql, desc, inArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL } from '@/lib/env'
import { normalizeNidaNumber, verifyNidaNumber } from '@/lib/kyc/selcom'
import { bindPhoneToNidaIdentity } from '@/lib/kyc/binding'
import { runIdentityLadder } from '@/lib/kyc/ladder'
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp'
import { authenticatePartner } from '@/lib/waas/auth'
import { generatePartnerSeed, deriveAddress, fundWalletWithGas } from '@/lib/waas/hd-wallets'
import { users, wallets, partnerUsers, partners, kycCases } from '@ntzs/db'

/**
 * POST /api/v1/users — Create a new user and provision an embedded wallet
 */
export async function POST(request: NextRequest) {
  try {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult

  // Guard: encryption key must be configured before any HD wallet operations
  if (!process.env.WAAS_ENCRYPTION_KEY) {
    console.error('[v1/users] WAAS_ENCRYPTION_KEY is not set')
    return NextResponse.json(
      { error: 'Server configuration error: wallet encryption key not set' },
      { status: 500 }
    )
  }

  let body: { externalId: string; email: string; name?: string; phone?: string; nidaNumber?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { externalId, email, name, phone, nidaNumber } = body

  if (!externalId || !email) {
    return NextResponse.json(
      { error: 'externalId and email are required' },
      { status: 400 }
    )
  }

  const { db } = getDb()

  // Check if this partner+externalId mapping already exists
  const [existing] = await db
    .select({
      userId: partnerUsers.userId,
      externalId: partnerUsers.externalId,
      walletIndex: partnerUsers.walletIndex,
    })
    .from(partnerUsers)
    .where(
      and(
        eq(partnerUsers.partnerId, partner.id),
        eq(partnerUsers.externalId, externalId)
      )
    )
    .limit(1)

  if (existing) {
    // Return existing user
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        phone: users.phone,
      })
      .from(users)
      .where(eq(users.id, existing.userId))
      .limit(1)

    let [wallet] = await db
      .select({ address: wallets.address })
      .from(wallets)
      .where(and(eq(wallets.userId, existing.userId), eq(wallets.chain, 'base')))
      .limit(1)

    // A mapping without a wallet is a Tier-C (manual review) user: provision
    // the wallet once the review approved, otherwise report the KYC status so
    // the partner app can show "pending review" instead of retrying blindly.
    if (!wallet) {
      const [latestCase] = await db
        .select({ status: kycCases.status })
        .from(kycCases)
        .where(eq(kycCases.userId, existing.userId))
        .orderBy(desc(kycCases.createdAt))
        .limit(1)

      if (latestCase?.status === 'approved' && partner.encryptedHdSeed && existing.walletIndex !== null) {
        const address = deriveAddress(partner.encryptedHdSeed, existing.walletIndex)
        await db
          .insert(wallets)
          .values({ userId: existing.userId, chain: 'base', address, provider: 'external' })
        ;[wallet] = await db
          .select({ address: wallets.address })
          .from(wallets)
          .where(and(eq(wallets.userId, existing.userId), eq(wallets.chain, 'base')))
          .limit(1)
        if (BASE_RPC_URL) {
          fundWalletWithGas({ toAddress: address, rpcUrl: BASE_RPC_URL }).catch((err) =>
            console.error('[v1/users] Gas prefund failed for', address, err?.message)
          )
        }
      } else {
        return NextResponse.json({
          id: existing.userId,
          externalId: existing.externalId,
          email: user?.email,
          name: user?.name || null,
          phone: user?.phone,
          walletAddress: null,
          balance: 0,
          kycStatus: latestCase?.status === 'pending' ? 'pending_review' : latestCase?.status ?? 'none',
        })
      }
    }

    return NextResponse.json({
      id: existing.userId,
      externalId: existing.externalId,
      email: user?.email,
      name: user?.name || null,
      phone: user?.phone,
      walletAddress: wallet?.address || null,
      balance: 0,
    })
  }

  // STRUCTURAL PREREQUISITE (BoT Parameter 8): no end-user wallet is ever
  // issued without a KYC-verified identity — independent of any pause flag.
  // Partners get compliant wallets by construction. (This gate sits BELOW the
  // existing-mapping return: partner apps call this endpoint idempotently on
  // every session to resolve existing users.)
  if (!nidaNumber) {
    return NextResponse.json(
      { error: 'A NIDA number is required to create a wallet — identity verification is a prerequisite for holding nTZS.', code: 'kyc_required' },
      { status: 400 }
    )
  }

  const normalizedNida = normalizeNidaNumber(nidaNumber)
  if (!normalizedNida) {
    return NextResponse.json({ error: 'Invalid NIDA number format (20 digits required).', code: 'kyc_failed' }, { status: 400 })
  }

  // Policy: one NIDA backs at most ONE wallet per partner ('pending' counts —
  // a NIDA under review must not be registrable twice).
  const [nidaTaken] = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .innerJoin(partnerUsers, eq(partnerUsers.userId, kycCases.userId))
    .where(
      and(
        eq(partnerUsers.partnerId, partner.id),
        inArray(kycCases.status, ['approved', 'pending']),
        sql`regexp_replace(${kycCases.nationalId}, '\\D', '', 'g') = ${normalizedNida}`
      )
    )
    .limit(1)
  if (nidaTaken) {
    return NextResponse.json(
      { error: 'This NIDA number is already linked to a wallet (or a verification under review) with this partner.', code: 'nida_already_registered' },
      { status: 409 }
    )
  }

  // Selcom verifies the NIDA + phone as a PAIR (both required since 13 Jul
  // 2026), so the phone must be valid before verification can run.
  if (!phone || !isValidTanzanianPhone(phone)) {
    return NextResponse.json(
      { error: 'A valid Tanzanian phone number is required to create a wallet.', code: 'phone_required' },
      { status: 400 }
    )
  }

  // Risk-tiered verification ladder (see lib/kyc/ladder.ts): Selcom pair
  // check (Tier A) → telco SIM-registration evidence (Tier B) → manual
  // review queue (Tier C). No outcome is a dead end.
  const verdict = await runIdentityLadder(
    { verifyPair: verifyNidaNumber, bindPhone: bindPhoneToNidaIdentity },
    { nidaNumber: normalizedNida, phone }
  )

  if (verdict.outcome === 'unavailable') {
    console.error('[v1/users] KYC verification unavailable:', verdict.error)
    return NextResponse.json(
      { error: verdict.userMessage, code: 'kyc_unavailable' },
      { status: 503 }
    )
  }
  if (verdict.outcome === 'rejected') {
    return NextResponse.json(
      { error: verdict.userMessage, code: verdict.code },
      { status: 400 }
    )
  }

  // Create new user (both for instant approval and Tier-C review — a review
  // user exists without a wallet until Backstage approves the case).
  // Use a generated neonAuthUserId placeholder for WaaS-created users
  const neonAuthUserId = `waas_${partner.id}_${externalId}`

  const [newUser] = await db
    .insert(users)
    .values({
      neonAuthUserId,
      email,
      name: name || null,
      phone: normalizePhone(phone),
      role: 'end_user',
    })
    .onConflictDoNothing()
    .returning({ id: users.id, email: users.email, name: users.name, phone: users.phone })

  let userId: string
  let userEmail: string
  let userName: string | null
  let userPhone: string | null

  if (newUser) {
    userId = newUser.id
    userEmail = newUser.email
    userName = newUser.name
    userPhone = newUser.phone
  } else {
    const [existingUser] = await db
      .select({ id: users.id, email: users.email, name: users.name, phone: users.phone })
      .from(users)
      .where(eq(users.neonAuthUserId, neonAuthUserId))
      .limit(1)

    if (!existingUser) {
      return NextResponse.json({ error: 'Failed to create or resolve partner-scoped user' }, { status: 500 })
    }
    userId = existingUser.id
    userEmail = existingUser.email
    userName = existingUser.name
    userPhone = existingUser.phone
  }

  // Record the identity link (BoT Para 8) before issuing the wallet:
  // instant approval for Tier-A verdicts, 'pending' for Tier-C review.
  await db.insert(kycCases).values(
    verdict.outcome === 'approved'
      ? {
          userId,
          nationalId: normalizedNida,
          status: 'approved' as const,
          provider: verdict.provider,
          providerReference: verdict.reference,
          reviewedAt: new Date(),
          reviewReason: verdict.evidence,
        }
      : {
          userId,
          nationalId: normalizedNida,
          status: 'pending' as const,
          provider: 'selcom_nida',
          reviewReason: verdict.evidence,
        }
  )

  // Ensure partner has an HD seed (auto-generate on first user creation)
  let encryptedSeed = partner.encryptedHdSeed
  if (!encryptedSeed) {
    const { encryptedSeed: newSeed } = generatePartnerSeed()
    await db
      .update(partners)
      .set({ encryptedHdSeed: newSeed, updatedAt: new Date() })
      .where(eq(partners.id, partner.id))
    encryptedSeed = newSeed
    console.log('[v1/users] Generated HD seed for partner:', partner.id)
  }

  // Atomically claim the next wallet index for this user
  const [indexResult] = await db
    .update(partners)
    .set({
      nextWalletIndex: sql`${partners.nextWalletIndex} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(partners.id, partner.id))
    .returning({ walletIndex: partners.nextWalletIndex })

  // nextWalletIndex was incremented, so the assigned index is (new value - 1)
  const walletIndex = (indexResult?.walletIndex ?? 1) - 1

  // Derive the deterministic wallet address instantly
  const walletAddress = deriveAddress(encryptedSeed, walletIndex)

  // Create partner_users mapping with wallet index
  await db
    .insert(partnerUsers)
    .values({
      partnerId: partner.id,
      userId,
      externalId,
      walletIndex,
    })
    .onConflictDoNothing()

  // Tier C: the user + mapping exist (walletIndex claimed so the address is
  // deterministic), but NO wallet until Backstage approves the pending case.
  // The partner re-calls this endpoint (idempotent) and gets the wallet once
  // approval lands.
  if (verdict.outcome !== 'approved') {
    return NextResponse.json(
      {
        id: userId,
        externalId,
        email: userEmail,
        name: userName,
        phone: userPhone,
        walletAddress: null,
        balance: 0,
        kycStatus: 'pending_review',
        code: 'kyc_pending_review',
        message: verdict.userMessage,
      },
      { status: 202 }
    )
  }

  // Check if wallet already exists for this user on Base
  let [wallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)

  if (!wallet) {
    const [newWallet] = await db
      .insert(wallets)
      .values({
        userId,
        chain: 'base',
        address: walletAddress,
        provider: 'external',
      })
      .returning({ id: wallets.id, address: wallets.address })

    wallet = newWallet

    // Prefund the new wallet with ETH for gas (fire-and-forget, non-blocking)
    const rpcUrl = BASE_RPC_URL
    if (rpcUrl && walletAddress) {
      fundWalletWithGas({ toAddress: walletAddress, rpcUrl }).catch((err) =>
        console.error('[v1/users] Gas prefund failed for', walletAddress, err?.message)
      )
    }
  }

  return NextResponse.json(
    {
      id: userId,
      externalId,
      email: userEmail,
      name: userName,
      phone: userPhone,
      walletAddress: wallet?.address || null,
      balance: 0,
    },
    { status: 201 }
  )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[v1/users] Unhandled error:', message)
    return NextResponse.json({ error: 'Internal server error', detail: message }, { status: 500 })
  }
}
