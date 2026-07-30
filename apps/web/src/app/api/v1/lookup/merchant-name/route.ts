import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { isTestMode, testLookupMerchant } from '@/lib/testmode'
import { authenticatePartner } from '@/lib/waas/auth'
import { nedaAccountLookup } from '@/lib/psp/selcom'
import { getBiller, validateUtilityRef, SELCOM_BILLERS } from '@/lib/psp/selcom-billers'
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit'

const LOOKUPS_PER_MINUTE = 60

/**
 * POST /api/v1/lookup/merchant-name — resolve the registered trading name for a
 * merchant Lipa Namba (including a TANQR scan, which resolves to one) or a bill
 * account, so a client can show "Paying: KARIAKOO HARDWARE LIMITED" on the
 * confirmation screen.
 *
 * Body: { kind: 'lipa', payNumber } | { kind: 'bill', utilityCode, utilityRef }
 *
 * ── Why this exists separately from the quote ──────────────────────────────
 * Both /v1/spend/quote and /v1/ramp/quote already resolve and disclose this
 * name. But a quote is a priced, single-use, expiring commitment, and a scan
 * is not: a user points a camera at a QR long before they have chosen an
 * amount. Making the name available only through a quote forces clients to
 * mint and discard quotes to render a screen, which is both wasteful and a
 * worse contract. Validation is its own step.
 *
 * ── Deliberately NOT behind the spend or ramp payment flags ────────────────
 * This endpoint resolves a name; it moves no money and opens no payment rail.
 * Gating it behind RAMP_SPEND_ENABLED would stop a partner building and
 * testing their confirmation UX until the rail is approved, which gets the
 * sequencing exactly backwards — integration should be finished and waiting
 * when approval lands, not started then.
 *
 * ── Fail-soft, like the recipient lookup ───────────────────────────────────
 * `name: null` means "no confirmation available", with `reason` distinguishing
 * an unregistered destination from an enquiry service that is down. A client
 * shows the raw number with a warning; it never blocks on null. A *malformed*
 * request is still a 400 — an unknown biller code is a bug in the caller, not
 * an unverifiable merchant.
 *
 * Guardrails: per-partner rate limit + an audit row per lookup. Trading names
 * are less sensitive than personal ones, but this must not become a way to
 * enumerate the country's till directory.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult

  // TEST MODE: deterministic trading names, no PSP call and no lookup quota.
  if (isTestMode(partner)) return testLookupMerchant(request)

  try {
    await enforceRateLimit(`merchantlookup:${partner.id}`, LOOKUPS_PER_MINUTE, 60)
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Too many lookups — slow down and retry shortly.' },
        { status: 429, headers: { 'Retry-After': String(err.retryAfterSec) } }
      )
    }
    throw err
  }

  let body: { kind?: unknown; payNumber?: unknown; utilityCode?: unknown; utilityRef?: unknown; amountTzs?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const kind = body.kind === 'bill' ? 'bill' : body.kind === 'lipa' ? 'lipa' : null
  if (!kind) {
    return NextResponse.json({ error: "kind must be 'lipa' or 'bill'" }, { status: 400 })
  }

  // Same validation the quote applies, so a destination that passes here
  // cannot be rejected by the quote for its shape.
  let lookupBank: string
  let lookupAccount: string
  let target: string
  let echo: Record<string, string>

  if (kind === 'lipa') {
    const payNumber = String(body.payNumber ?? '').replace(/\s+/g, '')
    if (!/^\d{4,12}$/.test(payNumber)) {
      return NextResponse.json({ error: 'payNumber must be the merchant Lipa Namba (4–12 digits)' }, { status: 400 })
    }
    lookupBank = 'SB2LIPA'
    lookupAccount = payNumber
    target = `lipa:${payNumber}`
    echo = { payNumber }
  } else {
    const utilityCode = String(body.utilityCode ?? '').trim().toUpperCase()
    const utilityRef = String(body.utilityRef ?? '').trim()
    const biller = getBiller(utilityCode)
    if (!biller) {
      return NextResponse.json(
        {
          error: 'unknown_biller',
          message: `utilityCode '${utilityCode}' is not in the biller catalogue.`,
          supportedCodes: SELCOM_BILLERS.map((b) => b.code),
        },
        { status: 400 }
      )
    }
    const refCheck = validateUtilityRef(utilityCode, utilityRef)
    if (!refCheck.ok) {
      return NextResponse.json({ error: 'invalid_utility_ref', message: refCheck.reason }, { status: 400 })
    }
    lookupBank = utilityCode
    lookupAccount = utilityRef
    target = `bill:${utilityCode}:${utilityRef}`
    echo = { utilityCode, utilityRef }
  }

  // Biller validation is amount-aware. Clients that know the purchase amount
  // send it for an exact answer; the default is the biller floor LUKU itself
  // stated when probed without one. Ignored for lipa.
  const amountRaw = Number(body.amountTzs)
  const amountTzs =
    kind === 'bill' ? (Number.isFinite(amountRaw) && amountRaw > 0 ? Math.trunc(amountRaw) : 1000) : undefined

  let name: string | null = null
  let reason: string | undefined
  try {
    const info = await nedaAccountLookup(lookupBank, lookupAccount, { amountTzs })
    name = info.name
    if (!info.name) reason = info.reason
  } catch (err) {
    name = null
    reason = 'lookup_unavailable'
    console.warn('[v1/lookup/merchant-name] lookup failed:', err instanceof Error ? err.message : err)
  }

  try {
    const { sql } = getDb()
    await sql`
      insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
      values ('partner.merchant_lookup', 'partner', ${partner.id}, ${JSON.stringify({
        kind,
        target,
        found: Boolean(name),
      })}::jsonb, now())
    `
  } catch (err) {
    console.warn('[v1/lookup/merchant-name] audit insert failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ kind, target, ...echo, name, ...(name ? {} : { reason }) })
}
