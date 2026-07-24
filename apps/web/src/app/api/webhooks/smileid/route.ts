import { and, desc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { auditLogs, kycCases, partnerUsers, users } from '@ntzs/db'
import { bindPhoneToNidaIdentity } from '@/lib/kyc/binding'
import { sameIdNumber } from '@/lib/kyc/name-match'
import { maskShape } from '@/lib/kyc/selcom'
import { interpretSmileIdResult, verifySmileIdWebhookSignature } from '@/lib/kyc/smileid'
import { invalidateKycCache } from '@/lib/user/cachedQueries'
import { queuePartnerWebhook } from '@/lib/waas/partner-webhooks'

/**
 * SmileID result webhook (all products; primarily document_verification).
 *
 * SECURITY MODEL — signed headers, claims-only body: SmileID signs
 * Response-Timestamp + partner_id + 'sid_request' with our API key
 * (verified fail-closed, stale-rejected), but the signature does NOT cover
 * the body. So the payload may only ever move OUR pre-existing kyc_case
 * through its state machine — it can never create cases, touch wallets, or
 * choose which user it applies to beyond the correlation keys WE bound into
 * the session token (partner_params.kyc_case_id).
 *
 * Delivery contract (their docs): at-least-once, possibly out of order, 3
 * retries on non-2xx, 35s ack deadline. Hence: idempotent (terminal cases
 * no-op), every unknown/unrecognized payload is ACKed-and-ignored so retries
 * stop, and heavy work stays out of the request path.
 *
 * Verdict application mirrors the ladder's fail-closed matrix
 * (lib/kyc/smileid.ts interpretSmileIdResult):
 *   approved → kyc_cases 'approved' (wallet provisioning stays with the
 *              existing idempotent WaaS re-call / direct-app layout path —
 *              this handler never provisions anything)
 *   review   → stays 'pending' with evidence (Backstage → KYC, Tier C)
 *   rejected → 'rejected'
 *   error    → stays 'pending', evidence recorded (job failure ≠ verdict)
 *
 * Expected response: 200 {"received": true}.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const signature = request.headers.get('response-signature')
  const timestamp = request.headers.get('response-timestamp')
  if (!verifySmileIdWebhookSignature({ signature, timestamp })) {
    console.warn('[smileid webhook] rejected: bad/missing signature or stale timestamp')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { correlation, verdict } = interpretSmileIdResult(payload)

  if (verdict.outcome === 'unrecognized') {
    // Shape-only diagnostic — never the body (citizen PII).
    console.warn('[smileid webhook] unrecognized payload:', verdict.detail, JSON.stringify(maskShape(payload)))
    return NextResponse.json({ received: true, ignored: 'unrecognized payload' })
  }

  const { db } = getDb()

  // ── Correlate to OUR case: partner_params.kyc_case_id (bound at token
  // mint) → job reference → SmileID user handle. ─────────────────────────────
  const caseColumns = {
    id: kycCases.id,
    userId: kycCases.userId,
    status: kycCases.status,
    nationalId: kycCases.nationalId,
    idType: kycCases.idType,
    country: kycCases.country,
    providerReference: kycCases.providerReference,
    providerUserId: kycCases.providerUserId,
  }

  let kase: { id: string; userId: string; status: string; nationalId: string | null; idType: string | null; country: string; providerReference: string | null; providerUserId: string | null } | undefined

  if (correlation.kycCaseId && UUID_RE.test(correlation.kycCaseId)) {
    ;[kase] = await db.select(caseColumns).from(kycCases).where(eq(kycCases.id, correlation.kycCaseId)).limit(1)
  }
  if (!kase && correlation.jobId) {
    ;[kase] = await db
      .select(caseColumns)
      .from(kycCases)
      .where(eq(kycCases.providerReference, correlation.jobId))
      .orderBy(desc(kycCases.createdAt))
      .limit(1)
  }
  if (!kase && correlation.smileUserId) {
    ;[kase] = await db
      .select(caseColumns)
      .from(kycCases)
      .where(eq(kycCases.providerUserId, correlation.smileUserId))
      .orderBy(desc(kycCases.createdAt))
      .limit(1)
  }

  if (!kase) {
    console.warn('[smileid webhook] no case for result', {
      kycCaseId: correlation.kycCaseId,
      jobId: correlation.jobId,
    })
    return NextResponse.json({ received: true, ignored: 'unknown case' })
  }

  // Idempotency: terminal cases never move again — replays become no-ops.
  if (kase.status === 'approved' || kase.status === 'rejected') {
    return NextResponse.json({ received: true, ignored: `already ${kase.status}` })
  }

  const refs = {
    providerReference: kase.providerReference ?? correlation.jobId,
    providerUserId: kase.providerUserId ?? correlation.smileUserId,
    updatedAt: new Date(),
  }
  const pendingGuard = and(eq(kycCases.id, kase.id), eq(kycCases.status, 'pending'))

  if (verdict.outcome === 'processing') {
    await db.update(kycCases).set(refs).where(pendingGuard)
    return NextResponse.json({ received: true, status: 'processing' })
  }

  // ── Cross-checks before an approval is honored (fail toward review) ────────
  // A 'clear' document alone carries the day for a case with no prior claims,
  // but claims we already hold MUST agree with it:
  //  1. The number ON the document must equal the NIDA claimed at signup — a
  //     genuine card belonging to someone else never approves a case.
  //  2. TZ only: the telco SIM registration behind the user's phone (NIDA +
  //     fingerprints by law) corroborates the document holder's name. Ladder
  //     rules: a contradiction outranks the document; telco silence never
  //     blocks (same posture as non-TZ users, who have no telco leg at all).
  let final = verdict
  if (verdict.outcome === 'approved') {
    if (kase.nationalId && verdict.idNumber && !sameIdNumber(verdict.idNumber, kase.nationalId)) {
      final = {
        outcome: 'review',
        reason: 'document_id_mismatch',
        evidence: `Document ID number does not match the NIDA claimed at signup · ${verdict.evidence}`,
      }
    } else if (kase.country === 'TZ') {
      const [holder] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, kase.userId)).limit(1)
      const comparableNida = kase.nationalId ?? verdict.idNumber
      if (holder?.phone && comparableNida) {
        const binding = await bindPhoneToNidaIdentity({
          phone: holder.phone,
          nidaNumber: comparableNida,
          nidaFullName: verdict.fullName,
        })
        if (binding.outcome === 'mismatch') {
          final = {
            outcome: 'review',
            reason: 'telco_contradiction',
            evidence: `Document verified but telco registration contradicts: ${binding.evidence} · ${verdict.evidence}`,
          }
        } else {
          final = { ...verdict, evidence: `${verdict.evidence} · ${binding.evidence}` }
        }
      }
    }
  }

  if (final.outcome === 'approved') {
    await db
      .update(kycCases)
      .set({
        ...refs,
        status: 'approved',
        // The extracted document number becomes the case's ID number — but an
        // ID captured at submission is never overwritten by vendor data.
        nationalId: kase.nationalId ?? final.idNumber,
        idType: kase.idType ?? final.idType,
        reviewedAt: new Date(),
        reviewReason: final.evidence,
      })
      .where(pendingGuard)
  } else if (final.outcome === 'rejected') {
    await db
      .update(kycCases)
      .set({ ...refs, status: 'rejected', reviewedAt: new Date(), reviewReason: final.evidence })
      .where(pendingGuard)
  } else {
    // 'review' parks for Tier C; 'error' records the failed attempt — both
    // stay 'pending' so Backstage → KYC (or a fresh capture session) decides.
    await db.update(kycCases).set({ ...refs, reviewReason: final.evidence }).where(pendingGuard)
  }

  invalidateKycCache(kase.userId)

  await db.insert(auditLogs).values({
    action: `kyc.smileid.${final.outcome}`,
    entityType: 'kyc_case',
    entityId: kase.id,
    metadata: {
      jobId: correlation.jobId,
      outcome: final.outcome,
      reason: 'reason' in final ? final.reason : null,
      via: 'webhook',
    },
  })

  // Notify the owning partner (if this is a WaaS user) through the queued,
  // signed, retried partner-webhook channel — mirroring the #118 kycStatus
  // vocabulary: approved | pending_review | rejected.
  if (final.outcome !== 'error') {
    const [mapping] = await db
      .select({ partnerId: partnerUsers.partnerId, externalId: partnerUsers.externalId })
      .from(partnerUsers)
      .where(eq(partnerUsers.userId, kase.userId))
      .limit(1)

    if (mapping) {
      await queuePartnerWebhook(mapping.partnerId, 'kyc.updated', {
        externalId: mapping.externalId,
        kycStatus: final.outcome === 'approved' ? 'approved' : final.outcome === 'rejected' ? 'rejected' : 'pending_review',
        provider: 'smileid',
        jobId: correlation.jobId,
      })
    }
  }

  return NextResponse.json({ received: true })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'smileid-webhook' })
}
