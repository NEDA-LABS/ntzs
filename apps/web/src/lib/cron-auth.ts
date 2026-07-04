import crypto from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * Authorize a cron invocation. Fails CLOSED:
 *   - if CRON_SECRET is not set, no request is authorized;
 *   - otherwise the caller must send `Authorization: Bearer <CRON_SECRET>`.
 *
 * Vercel Cron automatically attaches this header when a CRON_SECRET env var is
 * configured, so this is compatible with Vercel-scheduled jobs.
 *
 * We deliberately do NOT honour the `x-vercel-cron` header: it is a
 * client-settable request header, not an authenticated signal. The previous
 * guard (`CRON_SECRET && !isVercelCron && authHeader !== ...`) had two defects
 * this closes — it (a) failed OPEN when CRON_SECRET was unset, and (b) let
 * anyone bypass the check by sending `x-vercel-cron: 1`.
 *
 * DEPLOY PREREQUISITE: CRON_SECRET must be set in every environment, or all
 * cron endpoints (including Vercel-scheduled ones) will return 401.
 */
export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const provided = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // Length check first: timingSafeEqual throws on length mismatch.
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
