import { and, desc, eq, isNotNull, isNull, like, lt, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { isAuthorizedCron } from '@/lib/cron-auth'
import { getDb } from '@/lib/db'
import { auditLogs, kycCases } from '@ntzs/db'
import { getSmileIdJobStatus, isSmileIdConfigured, replaySmileIdCallback } from '@/lib/kyc/smileid'

export const maxDuration = 60

/**
 * GET /api/cron/reconcile-smileid — recover verifications whose result webhook
 * never landed, so a completed SmileID job never needs manual approval.
 *
 * WHY THIS EXISTS: document capture is submitted client-side, so a lost or
 * non-correlating callback leaves the case 'pending' with no recovery path —
 * exactly the cases a human was clearing by hand in Backstage. Same posture as
 * poll-selcom: the webhook is the fast path, the poller is the guarantee.
 *
 * HOW IT HEALS (deliberately indirect): for a pending case whose job SmileID
 * reports as terminal, we request a CALLBACK REPLAY rather than applying the
 * status here. The status response carries no id_fields, antifraud, or
 * receipt — approving from it would bypass the document-number consistency,
 * per-partner uniqueness, and fraud guards in the webhook handler. Replaying
 * pushes the full payload back through that one verified path, so a recovered
 * verdict is indistinguishable from a first-delivery one, evidence included.
 *
 * Bounded: only cases idle past the grace window are touched (webhook retries
 * get their chance first), REPLAY_CAP attempts per case, BATCH_LIMIT per run.
 * Cases with no reported job id cannot be reconciled at all — they are counted
 * and surfaced, because that is a partner-integration gap (see PATCH
 * /api/v1/users/:id/kyc/session), not something this cron can fix.
 */

/** Let SmileID's own retries (3, over minutes) play out before intervening. */
const GRACE_MINUTES = 15
/** Cases examined per run. */
const BATCH_LIMIT = 25
/** Give up after this many replays for one case — the Backstage queue is the floor. */
const REPLAY_CAP = 5

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isSmileIdConfigured()) {
      return NextResponse.json({ ok: true, skipped: 'smileid_not_configured' })
    }

    const { db } = getDb()
    const cutoff = new Date(Date.now() - GRACE_MINUTES * 60_000)

    const stale = await db
      .select({ id: kycCases.id, userId: kycCases.userId, jobId: kycCases.providerReference })
      .from(kycCases)
      .where(
        and(
          eq(kycCases.status, 'pending'),
          like(kycCases.provider, 'smileid%'),
          isNotNull(kycCases.providerReference),
          lt(kycCases.updatedAt, cutoff)
        )
      )
      .orderBy(desc(kycCases.updatedAt))
      .limit(BATCH_LIMIT)

    // Cases we cannot reach: a session was opened but no job id was ever
    // reported, so neither status nor replay is addressable.
    const [unreachable] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(kycCases)
      .where(
        and(
          eq(kycCases.status, 'pending'),
          like(kycCases.provider, 'smileid%'),
          isNull(kycCases.providerReference),
          lt(kycCases.updatedAt, cutoff)
        )
      )

    const counts = { examined: stale.length, replayed: 0, processing: 0, notFound: 0, capped: 0, failed: 0 }

    for (const kase of stale) {
      const jobId = kase.jobId as string

      const [priorAttempts] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'kyc.smileid.replay_requested'), eq(auditLogs.entityId, kase.id)))

      if ((priorAttempts?.n ?? 0) >= REPLAY_CAP) {
        counts.capped++
        continue
      }

      const status = await getSmileIdJobStatus(jobId)

      if (status.status === 'processing') {
        counts.processing++
        continue
      }
      if (status.status === 'not_found') {
        counts.notFound++
        console.warn('[reconcile-smileid] job unknown to SmileID', { caseId: kase.id, jobId })
        continue
      }
      if (status.status === 'unavailable') {
        counts.failed++
        console.error('[reconcile-smileid] status lookup failed', { caseId: kase.id, error: status.error })
        continue
      }

      // Terminal at SmileID but still pending here — the callback was lost.
      const replay = await replaySmileIdCallback(jobId)
      if (replay.status !== 'queued') {
        counts.failed++
        console.error('[reconcile-smileid] replay refused', { caseId: kase.id, error: replay.error })
        continue
      }

      counts.replayed++
      await db.insert(auditLogs).values({
        action: 'kyc.smileid.replay_requested',
        entityType: 'kyc_case',
        entityId: kase.id,
        metadata: { jobId, verdict: status.verdict, attempt: (priorAttempts?.n ?? 0) + 1, via: 'reconcile-cron' },
      })
      console.log('[reconcile-smileid] replay queued', { caseId: kase.id, jobId, verdict: status.verdict })
    }

    return NextResponse.json({
      ok: true,
      ...counts,
      // Not a failure of this cron — a signal that partners are not reporting
      // job ids yet, so those cases can only be cleared by a human.
      pendingWithoutJobId: unreachable?.n ?? 0,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[reconcile-smileid] Unhandled error:', message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
