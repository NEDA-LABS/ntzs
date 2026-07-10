import { eq, and, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL } from '@/lib/env'
import { normalizeNidaNumber, verifyNidaNumber } from '@/lib/kyc/selcom'
import { bindPhoneToNidaIdentity } from '@/lib/kyc/binding'
import { isValidTanzanianPhone } from '@/lib/psp'
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

    const [wallet] = await db
      .select({ address: wallets.address })
      .from(wallets)
      .where(and(eq(wallets.userId, existing.userId), eq(wallets.chain, 'base')))
      .limit(1)

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

  // Policy: one NIDA backs at most ONE wallet per partner.
  const [nidaTaken] = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .innerJoin(partnerUsers, eq(partnerUsers.userId, kycCases.userId))
    .where(
      and(
        eq(partnerUsers.partnerId, partner.id),
        eq(kycCases.status, 'approved'),
        sql`regexp_replace(${kycCases.nationalId}, '\\D', '', 'g') = ${normalizedNida}`
      )
    )
    .limit(1)
  if (nidaTaken) {
    return NextResponse.json(
      { error: 'This NIDA number is already linked to a wallet with this partner.', code: 'nida_already_registered' },
      { status: 409 }
    )
  }

  const verification = await verifyNidaNumber(normalizedNida)
  if (verification.status === 'unavailable') {
    console.error('[v1/users] KYC verification unavailable:', verification.error)
    return NextResponse.json(
      { error: 'Identity verification is temporarily unavailable — try again shortly.', code: 'kyc_unavailable' },
      { status: 503 }
    )
  }
  if (verification.status === 'not_found') {
    return NextResponse.json(
      { error: verification.message || 'NIDA number could not be verified.', code: 'kyc_failed' },
      { status: 400 }
    )
  }
  const kyc = { nidaNumber: normalizedNida, reference: verification.reference, fullName: verification.fullName }

  // Tier-1 identity binding: the phone must be a Tanzanian mobile-money line;
  // where the PSP name-lookup answers, its telco-registered identity must match
  // the NIDA holder (hard fail on mismatch). No answer => proceed, evidence
  // recorded as unverified.
  if (!phone || !isValidTanzanianPhone(phone)) {
    return NextResponse.json(
      { error: 'A valid Tanzanian phone number is required to create a wallet.', code: 'phone_required' },
      { status: 400 }
    )
  }
  const binding = await bindPhoneToNidaIdentity({ phone, nidaNumber: normalizedNida, nidaFullName: kyc.fullName })
  if (binding.outcome === 'mismatch') {
    return NextResponse.json(
      { error: 'This phone number is registered to a different person than the NIDA provided.', code: 'identity_binding_failed' },
      { status: 400 }
    )
  }

  // Create new user
  // Use a generated neonAuthUserId placeholder for WaaS-created users
  const neonAuthUserId = `waas_${partner.id}_${externalId}`
  
  const [newUser] = await db
    .insert(users)
    .values({
      neonAuthUserId,
      email,
      name: name || null,
      phone: binding.phone,
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

  // Record the verified identity link (BoT Para 8) before issuing the wallet.
  await db.insert(kycCases).values({
    userId,
    nationalId: kyc.nidaNumber,
    status: 'approved',
    provider: 'selcom_nida',
    providerReference: kyc.reference,
    reviewedAt: new Date(),
    reviewReason: `${kyc.fullName ? `NIDA holder: ${kyc.fullName}` : 'NIDA verified via Selcom Identity'} · ${binding.evidence}`,
  })

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
