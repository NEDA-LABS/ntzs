import { eq, and, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL } from '@/lib/env'
import { generatePartnerSeed, deriveAddress, fundWalletWithGas } from '@/lib/waas/hd-wallets'
import { users, wallets, partnerUsers, partners, kycCases } from '@ntzs/db'
import { verifySessionToken } from '@/lib/waas/auth'
import { normalizeNidaNumber, verifyNidaNumber } from '@/lib/kyc/selcom'
import { bindPhoneToNidaIdentity } from '@/lib/kyc/binding'
import { isValidTanzanianPhone } from '@/lib/psp'

/**
 * POST /api/v1/partners/users — Create a user wallet from the partner dashboard.
 * Auth: partner session cookie (same as dashboard).
 * Body: { externalId: string; email: string; name?: string; phone?: string }
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

  if (!process.env.WAAS_ENCRYPTION_KEY) {
    return NextResponse.json({ error: 'Server configuration error: wallet encryption key not set' }, { status: 500 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { externalId: string; email: string; name?: string; phone?: string; nidaNumber?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { externalId, email, name, phone, nidaNumber } = body

  if (!externalId || !email) {
    return NextResponse.json({ error: 'externalId and email are required' }, { status: 400 })
  }

  const { db } = getDb()

  // ── Fetch partner ───────────────────────────────────────────────────────────
  const [partner] = await db
    .select({
      id: partners.id,
      encryptedHdSeed: partners.encryptedHdSeed,
      nextWalletIndex: partners.nextWalletIndex,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }

  // ── Idempotency: check existing mapping ────────────────────────────────────
  const [existing] = await db
    .select({ userId: partnerUsers.userId, externalId: partnerUsers.externalId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partnerId), eq(partnerUsers.externalId, externalId)))
    .limit(1)

  if (existing) {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, phone: users.phone })
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
      alreadyExists: true,
    })
  }

  // STRUCTURAL PREREQUISITE (BoT Parameter 8): no end-user wallet is ever
  // issued without a KYC-verified identity — independent of any pause flag.
  // (Below the existing-mapping return so existing users always resolve.)
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
        eq(partnerUsers.partnerId, partnerId),
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

  // Selcom verifies the NIDA + phone as a PAIR (both required since 13 Jul
  // 2026), so the phone must be valid before verification can run.
  if (!phone || !isValidTanzanianPhone(phone)) {
    return NextResponse.json(
      { error: 'A valid Tanzanian phone number is required to create a wallet.', code: 'phone_required' },
      { status: 400 }
    )
  }

  const verification = await verifyNidaNumber(normalizedNida, phone)
  if (verification.status === 'unavailable') {
    console.error('[partners/users] KYC verification unavailable:', verification.error)
    return NextResponse.json(
      { error: 'Identity verification is temporarily unavailable — try again shortly.', code: 'kyc_unavailable' },
      { status: 503 }
    )
  }
  if (verification.status === 'mismatch') {
    // NIDA known to Selcom, phone registered to someone else — hard fail.
    return NextResponse.json(
      { error: 'This phone number is not registered to the holder of this NIDA number. Use the mobile money number registered in the user’s own name.', code: 'identity_binding_failed' },
      { status: 400 }
    )
  }
  if (verification.status === 'not_found') {
    return NextResponse.json(
      { error: 'This NIDA and phone number could not be verified together. Check both are correct and try again.', code: 'kyc_failed' },
      { status: 400 }
    )
  }
  const kyc = { nidaNumber: normalizedNida, reference: verification.reference, fullName: verification.fullName }

  // Tier-1 identity binding (supplementary evidence): where the PSP
  // name-lookup answers, its telco-registered identity must also match the
  // NIDA holder (hard fail on mismatch). No answer => proceed, evidence
  // recorded — Selcom's pair verification above is the primary binding.
  const binding = await bindPhoneToNidaIdentity({ phone, nidaNumber: normalizedNida, nidaFullName: kyc.fullName })
  if (binding.outcome === 'mismatch') {
    return NextResponse.json(
      { error: 'This phone number is registered to a different person than the NIDA provided.', code: 'identity_binding_failed' },
      { status: 400 }
    )
  }

  // ── Create user ─────────────────────────────────────────────────────────────
  const neonAuthUserId = `waas_${partnerId}_${externalId}`

  const [newUser] = await db
    .insert(users)
    .values({ neonAuthUserId, email, name: name || null, phone: binding.phone, role: 'end_user' })
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
    const [byAuthId] = await db
      .select({ id: users.id, email: users.email, name: users.name, phone: users.phone })
      .from(users)
      .where(eq(users.neonAuthUserId, neonAuthUserId))
      .limit(1)

    if (!byAuthId) {
      return NextResponse.json({ error: 'Failed to create or resolve partner-scoped user' }, { status: 500 })
    }
    userId = byAuthId.id
    userEmail = byAuthId.email
    userName = byAuthId.name
    userPhone = byAuthId.phone
  }

  // Record the verified identity link (BoT Para 8) before issuing the wallet.
  await db.insert(kycCases).values({
    userId,
    nationalId: kyc.nidaNumber,
    status: 'approved',
    provider: 'selcom_nida',
    providerReference: kyc.reference,
    reviewedAt: new Date(),
    reviewReason: `${kyc.fullName ? `NIDA holder: ${kyc.fullName}` : 'NIDA verified via Selcom Identity'} · Selcom NIDA+MSISDN pair verified · ${binding.evidence}`,
  })

  // ── Ensure partner has HD seed ──────────────────────────────────────────────
  let encryptedSeed = partner.encryptedHdSeed
  if (!encryptedSeed) {
    const { encryptedSeed: newSeed } = generatePartnerSeed()
    await db
      .update(partners)
      .set({ encryptedHdSeed: newSeed, updatedAt: new Date() })
      .where(eq(partners.id, partnerId))
    encryptedSeed = newSeed
  }

  // ── Claim wallet index atomically ───────────────────────────────────────────
  const [indexResult] = await db
    .update(partners)
    .set({ nextWalletIndex: sql`${partners.nextWalletIndex} + 1`, updatedAt: new Date() })
    .where(eq(partners.id, partnerId))
    .returning({ walletIndex: partners.nextWalletIndex })

  const walletIndex = (indexResult?.walletIndex ?? 1) - 1
  const walletAddress = deriveAddress(encryptedSeed, walletIndex)

  // ── Create partner_users mapping ────────────────────────────────────────────
  await db
    .insert(partnerUsers)
    .values({ partnerId, userId, externalId, walletIndex })
    .onConflictDoNothing()

  // ── Provision wallet record ─────────────────────────────────────────────────
  let [wallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)

  if (!wallet) {
    const [newWallet] = await db
      .insert(wallets)
      .values({ userId, chain: 'base', address: walletAddress, provider: 'external' })
      .returning({ id: wallets.id, address: wallets.address })

    wallet = newWallet

    const rpcUrl = BASE_RPC_URL
    if (rpcUrl && walletAddress) {
      fundWalletWithGas({ toAddress: walletAddress, rpcUrl }).catch((err) =>
        console.error('[partners/users] Gas prefund failed for', walletAddress, err?.message)
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
    },
    { status: 201 }
  )
}
