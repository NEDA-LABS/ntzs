import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { formatAttestationEvidence, normalizeIdentityKey, parseAttestation } from '@/lib/kyc/attestation'
import { getKycReliance } from '@/lib/kyc/reliance'
import { isTestMode, testNotSupported } from '@/lib/testmode'
import { invalidateKycCache } from '@/lib/user/cachedQueries'
import { authenticatePartner } from '@/lib/waas/auth'
import { queuePartnerWebhook } from '@/lib/waas/partner-webhooks'
import { provisionWalletForApprovedUser } from '@/lib/waas/provision-wallet'
import { auditLogs, kycCases, partnerUsers, users } from '@ntzs/db'

/**
 * POST /api/v1/users/:id/kyc/attestation — record the KYC decision a relied-upon
 * partner has already made, and act on it.
 *
 * The Selcom NIDA pair check verifies Tanzanians the registry knows, instantly.
 * Everyone else — a Tanzanian with no Selcom record, anyone holding a foreign
 * document — completes identity verification in the partner's own onboarding.
 * This endpoint is how that decision reaches us, and it is deliberately the
 * WHOLE journey: the case is approved and the wallet is issued in one call, so
 * a customer approved by their provider is never queued for a second approval
 * here just to receive the wallet they already qualified for.
 *
 * WHY THIS IS SAFE TO EXPOSE:
 *  - Reliance is granted per partner by compliance in Backstage and is off by
 *    default, so an API key on its own can never approve an identity.
 *  - An attestation must carry who verified, when, and against what document
 *    (lib/kyc/attestation.ts). "Trust me" is a 400.
 *  - It may not contradict what we already hold: a document number that
 *    disagrees with the NIDA on the case is a 409, not a silent overwrite.
 *  - One document identity backs at most one user per partner.
 *  - Everything lands in the audit log with the partner's own case reference,
 *    so the underlying file can be demanded and produced.
 *
 * Idempotent: re-attesting an approved user returns the same wallet.
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

    // TEST MODE: identity is simulated at user creation; a pending review is
    // cleared with POST /api/v1/testmode/users/:id/approve.
    if (isTestMode(partner)) return testNotSupported('KYC attestations')

    // ── Reliance gate: FIRST, before any body is read. A partner without the
    // grant learns nothing about our users from this endpoint. ───────────────
    const reliance = await getKycReliance(partner.id)
    if (!reliance.enabled) {
      return NextResponse.json(
        {
          error:
            'Your account is not approved to attest KYC outcomes. This requires a signed reliance agreement with NEDA Labs — contact compliance to arrange it.',
          code: 'kyc_reliance_not_granted',
        },
        { status: 403 }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { db } = getDb()

    // Scope: the user must belong to this partner.
    const [mapping] = await db
      .select({ externalId: partnerUsers.externalId })
      .from(partnerUsers)
      .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, userId)))
      .limit(1)
    if (!mapping) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const parsed = parseAttestation((body ?? {}) as Record<string, unknown>)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400 })
    }
    const attestation = parsed.value

    const [latestCase] = await db
      .select({
        id: kycCases.id,
        status: kycCases.status,
        nationalId: kycCases.nationalId,
        idType: kycCases.idType,
        country: kycCases.country,
      })
      .from(kycCases)
      .where(eq(kycCases.userId, userId))
      .orderBy(desc(kycCases.createdAt))
      .limit(1)

    // ── Already approved: idempotent. Still ensure the wallet exists — an
    // approval that never issued one is exactly the gap this endpoint closes.
    if (latestCase?.status === 'approved') {
      const provisioned = await provisionWalletForApprovedUser(userId)
      return NextResponse.json({
        id: userId,
        externalId: mapping.externalId,
        kycStatus: 'approved',
        alreadyVerified: true,
        walletAddress: 'address' in provisioned ? provisioned.address : null,
      })
    }

    const identityKey = normalizeIdentityKey(attestation.idNumber)

    if (attestation.decision === 'approved') {
      // ── The document must not contradict the identity we already hold. A
      // genuine document belonging to someone else never approves a case.
      //
      // Only like is compared with like: a passport number is not a NIDA, so
      // a Tanzanian who signed up with a NIDA and was later verified on their
      // passport is not a contradiction — the numbers SHOULD differ. Legacy
      // cases carry no idType, and for a TZ case that means NIDA. ────────────
      const heldIdType = latestCase?.idType ?? (latestCase?.country === 'TZ' ? 'NATIONAL_ID' : null)
      const comparable = heldIdType !== null && heldIdType === attestation.idType
      if (comparable && latestCase?.nationalId && identityKey && normalizeIdentityKey(latestCase.nationalId) !== identityKey) {
        return NextResponse.json(
          {
            error:
              'The document number on this attestation does not match the identity number already recorded for this user. Resolve the discrepancy with our compliance team before re-attesting.',
            code: 'identity_mismatch',
          },
          { status: 409 }
        )
      }

      // ── One document identity backs at most one user on a partner. ────────
      if (identityKey) {
        const [duplicate] = await db
          .select({ userId: kycCases.userId })
          .from(kycCases)
          .innerJoin(partnerUsers, eq(partnerUsers.userId, kycCases.userId))
          .where(
            and(
              eq(partnerUsers.partnerId, partner.id),
              ne(kycCases.userId, userId),
              inArray(kycCases.status, ['approved', 'pending']),
              sql`regexp_replace(upper(${kycCases.nationalId}), '[^A-Z0-9]', '', 'g') = ${identityKey}`
            )
          )
          .limit(1)
        if (duplicate) {
          return NextResponse.json(
            {
              error:
                'This identity document is already linked to another user on your platform (or to a verification under review).',
              code: 'identity_already_registered',
            },
            { status: 409 }
          )
        }
      }
    }

    const evidence = formatAttestationEvidence(attestation, partner.name)
    const now = new Date()
    const caseValues = {
      status: attestation.decision,
      provider: 'partner_attested',
      providerReference: attestation.reference,
      country: attestation.country,
      idType: attestation.idType,
      reviewedAt: now,
      reviewReason: evidence,
      updatedAt: now,
    } as const

    let caseId: string
    if (latestCase && latestCase.status === 'pending') {
      // Decide the case the user is already parked on, so the evidence trail
      // stays on one case instead of forking into a second row.
      const [updated] = await db
        .update(kycCases)
        .set({ ...caseValues, nationalId: latestCase.nationalId ?? attestation.idNumber })
        .where(and(eq(kycCases.id, latestCase.id), eq(kycCases.status, 'pending')))
        .returning({ id: kycCases.id })
      if (!updated) {
        // Lost a race with a reviewer in Backstage — their decision stands.
        return NextResponse.json(
          { error: 'This verification was just decided by a reviewer. Fetch the user to read the current status.', code: 'kyc_already_decided' },
          { status: 409 }
        )
      }
      caseId = updated.id
    } else {
      // No case, or a decided one — a re-attempt opens a fresh case.
      const [created] = await db
        .insert(kycCases)
        .values({ userId, nationalId: attestation.idNumber, ...caseValues })
        .returning({ id: kycCases.id })
      caseId = created.id
    }

    // Adopt the verified holder name when we hold none — never overwrite one
    // the user or partner already declared.
    if (attestation.decision === 'approved' && attestation.fullName) {
      await db
        .update(users)
        .set({ name: attestation.fullName, updatedAt: now })
        .where(and(eq(users.id, userId), sql`nullif(trim(${users.name}), '') is null`))
    }

    invalidateKycCache(userId)

    await db.insert(auditLogs).values({
      action: `kyc.attested.${attestation.decision}`,
      entityType: 'kyc_case',
      entityId: caseId,
      metadata: {
        partnerId: partner.id,
        partnerName: partner.name,
        externalId: mapping.externalId,
        reference: attestation.reference,
        verifiedBy: attestation.verifiedBy,
        verifiedAt: attestation.verifiedAt.toISOString(),
        idType: attestation.idType,
        country: attestation.country,
        method: attestation.method,
        relianceAgreementRef: reliance.agreementRef,
      },
    })

    if (attestation.decision === 'rejected') {
      await queuePartnerWebhook(partner.id, 'kyc.updated', {
        externalId: mapping.externalId,
        kycStatus: 'rejected',
        provider: 'partner_attested',
        reference: attestation.reference,
      })
      return NextResponse.json({
        id: userId,
        externalId: mapping.externalId,
        kycStatus: 'rejected',
        caseId,
        walletAddress: null,
      })
    }

    // Approval issues the wallet here and now — that is the point of the
    // endpoint. A skip is reported rather than swallowed, so an integrator
    // never sees "approved" and silently no wallet.
    const provisioned = await provisionWalletForApprovedUser(userId)

    await queuePartnerWebhook(partner.id, 'kyc.updated', {
      externalId: mapping.externalId,
      kycStatus: 'approved',
      provider: 'partner_attested',
      reference: attestation.reference,
    })

    return NextResponse.json({
      id: userId,
      externalId: mapping.externalId,
      kycStatus: 'approved',
      caseId,
      walletAddress: 'address' in provisioned ? provisioned.address : null,
      ...(provisioned.status === 'skipped' ? { walletPending: provisioned.reason } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[v1/users/:id/kyc/attestation] Unhandled error:', message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
