import { and, desc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import {
  isSmileIdConfigured,
  mintSmileIdToken,
  smileIdApiBaseUrl,
  smileIdEnvironment,
  smileIdPartnerId,
} from '@/lib/kyc/smileid'
import { auditLogs, kycCases, partnerUsers } from '@ntzs/db'

/**
 * POST /api/v1/users/:id/kyc/session — Open a SmileID document-verification
 * capture session for an existing partner user.
 *
 * This is the INSTANT alternative to the manual-review queue: when the Selcom
 * ladder has no record of a user (not a Selcom Pesa customer) — or the user
 * is outside Tanzania — the partner calls this instead of leaving them parked
 * in Tier C. The user photographs their ID + takes a selfie (~2 min), SmileID
 * verifies asynchronously, our webhook moves the case, and the partner's
 * idempotent create-user re-call provisions the wallet.
 *
 * Contract:
 *  - Mints a 15-minute SmileID v3 token with our kyc_case id bound into its
 *    partner_params claim (the tamper-proof correlation back to the case).
 *    The API key never leaves the server; the token is safe for the browser.
 *  - Reuses the user's existing pending case (evidence trail stays on one
 *    case) or opens a fresh one (also after a rejection — re-attempts are
 *    allowed, mirroring POST /users/:id/kyc).
 *  - Capture + submit happen client-side per SmileID's V3 contract
 *    (multipart POST {apiBaseUrl}/v3/document_verification with the returned
 *    token) — this endpoint never sees or stores images.
 *  - Never touches wallets or balances.
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

    // Body is optional: { country?: 'TZ' | ISO-3166-1 alpha-2 }
    let body: { country?: string } = {}
    try {
      body = await request.json()
    } catch {
      // No/empty body is fine — defaults apply.
    }
    const countryRaw = (body.country ?? 'TZ').toUpperCase()
    if (!/^[A-Z]{2}$/.test(countryRaw)) {
      return NextResponse.json(
        { error: 'country must be an ISO 3166-1 alpha-2 code (e.g. TZ, KE).', code: 'invalid_country' },
        { status: 400 }
      )
    }

    if (!isSmileIdConfigured()) {
      return NextResponse.json(
        { error: 'Document verification is temporarily unavailable. Please try again shortly.', code: 'kyc_unavailable' },
        { status: 503 }
      )
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

    const [latestCase] = await db
      .select({ id: kycCases.id, status: kycCases.status })
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

    // Reuse the pending case (keeps one case per user — a parked Tier-C case
    // simply gains a document-capture attempt), else open a fresh one
    // (including after a rejection — re-attempts are allowed).
    let caseId: string
    let createdFreshCase = false
    if (latestCase?.status === 'pending') {
      caseId = latestCase.id
      await db
        .update(kycCases)
        .set({ provider: 'smileid_docv', country: countryRaw, updatedAt: new Date() })
        .where(eq(kycCases.id, caseId))
    } else {
      const [fresh] = await db
        .insert(kycCases)
        .values({ userId, nationalId: null, status: 'pending', provider: 'smileid_docv', country: countryRaw })
        .returning({ id: kycCases.id })
      caseId = fresh.id
      createdFreshCase = true
    }

    const minted = await mintSmileIdToken({
      userId,
      product: 'document_verification',
      partnerParams: { kyc_case_id: caseId, external_id: mapping.externalId },
    })

    if (minted.status !== 'ok') {
      // Don't strand the user in 'pending' behind a session that never
      // existed — but never delete a case that predates this request.
      if (createdFreshCase) {
        await db.delete(kycCases).where(and(eq(kycCases.id, caseId), eq(kycCases.status, 'pending')))
      }
      console.error('[v1/users/:id/kyc/session] token mint failed:', minted.error)
      return NextResponse.json(
        { error: 'Document verification is temporarily unavailable. Please try again shortly.', code: 'kyc_unavailable' },
        { status: 503 }
      )
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
    const callbackUrl = process.env.SMILEID_CALLBACK_URL || (appUrl ? `${appUrl}/api/webhooks/smileid` : null)

    await db.insert(auditLogs).values({
      action: 'kyc.smileid.session_created',
      entityType: 'kyc_case',
      entityId: caseId,
      metadata: { partnerId: partner.id, externalId: mapping.externalId, country: countryRaw },
    })

    return NextResponse.json(
      {
        id: userId,
        externalId: mapping.externalId,
        kycStatus: 'pending_review',
        caseId,
        session: {
          token: minted.token,
          smilePartnerId: smileIdPartnerId(),
          environment: smileIdEnvironment(),
          apiBaseUrl: smileIdApiBaseUrl(),
          product: 'document_verification',
          submitPath: '/v3/document_verification',
          country: countryRaw,
          // Include these as JSON-string multipart parts on the submit; the
          // token already carries them as signed claims (belt and braces).
          partnerParams: { kyc_case_id: caseId, external_id: mapping.externalId },
          callbackUrl,
          expiresInSeconds: 900,
        },
      },
      { status: 201 }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[v1/users/:id/kyc/session] Unhandled error:', message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
