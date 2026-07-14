import { eq, and, desc, sql, inArray, ne } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL } from '@/lib/env'
import { authenticatePartner } from '@/lib/waas/auth'
import { deriveAddress, fundWalletWithGas } from '@/lib/waas/hd-wallets'
import { normalizeNidaNumber, verifyNidaNumber } from '@/lib/kyc/selcom'
import { bindPhoneToNidaIdentity } from '@/lib/kyc/binding'
import { runIdentityLadder } from '@/lib/kyc/ladder'
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp'
import { users, wallets, partnerUsers, kycCases } from '@ntzs/db'

/**
 * POST /api/v1/users/:id/kyc — Attach a verified identity to an EXISTING
 * partner user: retro-KYC for wallets issued before the KYC standard, and
 * re-attempts after a rejected review. Create-user is get-or-create and
 * returns existing users early, so this is the only partner path that can
 * verify someone who already exists.
 *
 * Runs the same risk-tiered ladder as create-user (Selcom pair check →
 * telco SIM evidence → manual review queue). Campaign posture is
 * prompt-only: this endpoint NEVER touches the user's existing wallet or
 * balance — it only records identity. The one additive effect: a Tier-C
 * signup (mapping without a wallet) gets its wallet provisioned the moment
 * an approval lands here.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticatePartner(request)
    if ('error' in authResult) return authResult.error

    const { partner } = authResult
    const { id: userId } = await params

    let body: { nidaNumber?: string; phone?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { db } = getDb()

    // Scope: the user must belong to this partner.
    const [mapping] = await db
      .select({ externalId: partnerUsers.externalId, walletIndex: partnerUsers.walletIndex })
      .from(partnerUsers)
      .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, userId)))
      .limit(1)
    if (!mapping) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Idempotency: decided/queued identities are never re-run.
    const [latestCase] = await db
      .select({ status: kycCases.status })
      .from(kycCases)
      .where(eq(kycCases.userId, userId))
      .orderBy(desc(kycCases.createdAt))
      .limit(1)

    if (latestCase?.status === 'approved') {
      return NextResponse.json({
        id: userId,
        externalId: mapping.externalId,
        kycStatus: 'approved',
        alreadyVerified: true,
      })
    }
    if (latestCase?.status === 'pending') {
      return NextResponse.json(
        {
          id: userId,
          externalId: mapping.externalId,
          kycStatus: 'pending_review',
          message: 'An identity verification for this user is already under manual review.',
        },
        { status: 202 }
      )
    }

    // Validate inputs (same rules as create-user).
    if (!body.nidaNumber) {
      return NextResponse.json(
        { error: 'A NIDA number is required to verify this user.', code: 'kyc_required' },
        { status: 400 }
      )
    }
    const normalizedNida = normalizeNidaNumber(body.nidaNumber)
    if (!normalizedNida) {
      return NextResponse.json({ error: 'Invalid NIDA number format (20 digits required).', code: 'kyc_failed' }, { status: 400 })
    }
    if (!body.phone || !isValidTanzanianPhone(body.phone)) {
      return NextResponse.json(
        { error: 'A valid Tanzanian phone number is required to verify this user.', code: 'phone_required' },
        { status: 400 }
      )
    }

    // Policy: one NIDA backs at most ONE wallet per partner — a NIDA already
    // approved or under review for a DIFFERENT user cannot be attached here.
    const [nidaTaken] = await db
      .select({ id: kycCases.id })
      .from(kycCases)
      .innerJoin(partnerUsers, eq(partnerUsers.userId, kycCases.userId))
      .where(
        and(
          eq(partnerUsers.partnerId, partner.id),
          ne(kycCases.userId, userId),
          inArray(kycCases.status, ['approved', 'pending']),
          sql`regexp_replace(${kycCases.nationalId}, '\\D', '', 'g') = ${normalizedNida}`
        )
      )
      .limit(1)
    if (nidaTaken) {
      return NextResponse.json(
        { error: 'This NIDA number is already linked to another wallet (or a verification under review) with this partner.', code: 'nida_already_registered' },
        { status: 409 }
      )
    }

    // Risk-tiered verification ladder (see lib/kyc/ladder.ts).
    const verdict = await runIdentityLadder(
      { verifyPair: verifyNidaNumber, bindPhone: bindPhoneToNidaIdentity },
      { nidaNumber: normalizedNida, phone: body.phone }
    )

    if (verdict.outcome === 'unavailable') {
      console.error('[v1/users/:id/kyc] verification unavailable:', verdict.error)
      return NextResponse.json(
        { error: verdict.userMessage, code: 'kyc_unavailable' },
        { status: 503 }
      )
    }

    if (verdict.outcome === 'rejected') {
      // The user exists, so the negative verdict is recorded for audit
      // (unlike create-user, where no user exists to attach a case to).
      await db.insert(kycCases).values({
        userId,
        nationalId: normalizedNida,
        status: 'rejected',
        provider: 'selcom_nida',
        reviewedAt: new Date(),
        reviewReason: verdict.evidence,
      })
      return NextResponse.json(
        { error: verdict.userMessage, code: verdict.code, kycStatus: 'rejected' },
        { status: 400 }
      )
    }

    if (verdict.outcome === 'review') {
      await db.insert(kycCases).values({
        userId,
        nationalId: normalizedNida,
        status: 'pending',
        provider: 'selcom_nida',
        reviewReason: verdict.evidence,
      })
      await db.update(users).set({ phone: normalizePhone(body.phone), updatedAt: new Date() }).where(eq(users.id, userId))
      return NextResponse.json(
        {
          id: userId,
          externalId: mapping.externalId,
          kycStatus: 'pending_review',
          code: 'kyc_pending_review',
          message: verdict.userMessage,
        },
        { status: 202 }
      )
    }

    // Approved (Tier A).
    await db.insert(kycCases).values({
      userId,
      nationalId: normalizedNida,
      status: 'approved',
      provider: verdict.provider,
      providerReference: verdict.reference,
      reviewedAt: new Date(),
      reviewReason: verdict.evidence,
    })
    await db.update(users).set({ phone: normalizePhone(body.phone), updatedAt: new Date() }).where(eq(users.id, userId))

    // Legacy users already hold a wallet — untouched. A Tier-C signup that
    // was waiting on review gets its wallet now.
    let [wallet] = await db
      .select({ address: wallets.address })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
      .limit(1)

    if (!wallet && partner.encryptedHdSeed && mapping.walletIndex !== null) {
      const address = deriveAddress(partner.encryptedHdSeed, mapping.walletIndex)
      await db.insert(wallets).values({ userId, chain: 'base', address, provider: 'external' })
      ;[wallet] = await db
        .select({ address: wallets.address })
        .from(wallets)
        .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
        .limit(1)
      if (BASE_RPC_URL) {
        fundWalletWithGas({ toAddress: address, rpcUrl: BASE_RPC_URL }).catch((err) =>
          console.error('[v1/users/:id/kyc] Gas prefund failed for', address, err?.message)
        )
      }
    }

    return NextResponse.json({
      id: userId,
      externalId: mapping.externalId,
      kycStatus: 'approved',
      walletAddress: wallet?.address || null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[v1/users/:id/kyc] Unhandled error:', message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
