import { and, eq, isNull, or, type SQL } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { isMissingSchemaObject } from '@/lib/db-errors'
import { db } from '@/lib/merchant/db'
import { capabilityError, hasCapability } from '@/lib/platform/capabilities'
import { requireServiceKey } from '@/lib/service-auth'
import { authenticatePartner } from '@/lib/waas/auth'
import { isTestMode } from '@/lib/testmode'
import { merchantAccounts, partners } from '@ntzs/db'

/**
 * Who is calling a Biashara endpoint — TWO DOORS, deliberately.
 *
 * ── service ──────────────────────────────────────────────────────────────
 * `x-service-key`. The first-party door: NEDApay and our own merchant portal.
 * Its behaviour is byte-for-byte what it has always been — same header, same
 * merchant resolution, same responses. Nothing about this door is on a
 * deprecation path; it is not going away.
 *
 * ── partner ──────────────────────────────────────────────────────────────
 * `Authorization: Bearer ntzs_…` + the `biashara` capability. For third-party
 * consumers embedding Biashara in their own app (a bank's merchant tab). A
 * partner may only ever touch merchants whose `partner_id` is their own.
 *
 * ── The isolation rule ───────────────────────────────────────────────────
 * First-party merchants carry `partner_id IS NULL`. Since a partner can only
 * match its own id, NULL matches no partner and the first-party book is
 * structurally unreachable through the partner door — with no backfill and no
 * relabelling of a single existing row. NULL fails safe.
 *
 * ── Deploy-order safety ──────────────────────────────────────────────────
 * `partner_id` arrives with drizzle/0067. Nothing on the SERVICE path reads or
 * writes that column, so NEDApay is unaffected by a deploy that lands ahead of
 * the migration. The partner path does read it — and cannot be reached until a
 * partner is granted the `biashara` capability, which happens after the
 * migration.
 */

export type BiasharaCaller =
  | { scope: 'service'; partnerId: null }
  | { scope: 'partner'; partnerId: string }

export type CallerResult = { caller: BiasharaCaller } | { error: NextResponse }

/** Authenticate through whichever door the request presents. */
export async function requireBiasharaCaller(req: NextRequest): Promise<CallerResult> {
  const authHeader = req.headers.get('authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const auth = await authenticatePartner(req)
    if ('error' in auth) return { error: auth.error }
    const { partner } = auth

    // Biashara moves real merchant money and has no simulator — a test key is
    // refused rather than silently served first-party data.
    if (isTestMode(partner)) {
      return {
        error: NextResponse.json(
          {
            error: 'not_available_in_test_mode',
            message:
              'Biashara is not simulated in test mode. Use a live key with the biashara capability — the merchant rails are proven against real payments.',
          },
          { status: 501 }
        ),
      }
    }

    const [row] = await db
      .select({ capabilities: partners.capabilities })
      .from(partners)
      .where(eq(partners.id, partner.id))
      .limit(1)
    if (!hasCapability(row?.capabilities ?? null, 'biashara')) {
      return { error: capabilityError('biashara') }
    }

    return { caller: { scope: 'partner', partnerId: partner.id } }
  }

  // No Bearer token → the first-party service door, exactly as before.
  const serviceError = requireServiceKey(req)
  if (serviceError) return { error: serviceError }
  return { caller: { scope: 'service', partnerId: null } }
}

export type MerchantResult = { caller: BiasharaCaller; merchantId: string } | { error: NextResponse }

/**
 * Authenticate, then resolve `x-merchant-id` WITHIN the caller's tenant.
 *
 * This is the function every Biashara route should use: putting the tenant
 * check in the same call as the auth check means a route cannot accidentally
 * do one without the other.
 *
 * A partner asking for a merchant that is not theirs gets 404 — not 403 —
 * so the API never confirms that some other tenant's merchant id exists.
 */
export async function requireBiasharaMerchant(req: NextRequest): Promise<MerchantResult> {
  const authResult = await requireBiasharaCaller(req)
  if ('error' in authResult) return authResult
  const { caller } = authResult

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) {
    return { error: NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 }) }
  }

  // Service scope keeps today's behaviour exactly: no extra lookup, routes
  // 404 on their own if the id is unknown.
  if (caller.scope === 'service') return { caller, merchantId }

  if (!/^[0-9a-f-]{36}$/i.test(merchantId)) {
    return { error: NextResponse.json({ error: 'Merchant not found' }, { status: 404 }) }
  }

  const [owned] = await db
    .select({ id: merchantAccounts.id })
    .from(merchantAccounts)
    .where(and(eq(merchantAccounts.id, merchantId), eq(merchantAccounts.partnerId, caller.partnerId)))
    .limit(1)

  if (!owned) {
    return { error: NextResponse.json({ error: 'Merchant not found' }, { status: 404 }) }
  }

  return { caller, merchantId }
}

/**
 * Tenant predicate for lookups by something other than id (email, userId).
 *
 * Service scope filters to `partner_id IS NULL` rather than staying unscoped.
 * That matches exactly the same rows it always has — every first-party row is
 * NULL — while stopping the reverse leak: without it, a first-party activation
 * for an email a partner already used would return the PARTNER's merchant.
 */
export function merchantTenantFilter(caller: BiasharaCaller): SQL {
  return caller.scope === 'partner'
    ? eq(merchantAccounts.partnerId, caller.partnerId)
    : isNull(merchantAccounts.partnerId)
}

/**
 * Resolve an existing merchant for activation (idempotency), tenant-scoped.
 *
 * Deploy-order: this is the ONLY Biashara query on the service path that names
 * `partner_id`, so it is also the only one that can meet a database where
 * drizzle/0067 has not been applied. On that error the SERVICE door falls back
 * to the pre-migration (unscoped) query — which is correct, because before the
 * migration no partner-owned merchant can exist for it to collide with.
 *
 * The PARTNER door never falls back: without the column there is no way to
 * enforce isolation, so it fails rather than guess.
 */
export async function findMerchantForActivation(
  caller: BiasharaCaller,
  userId: string,
  email: string
): Promise<{
  id: string
  handle: string
  walletAddress: string
  businessName: string | null
  userId: string | null
} | null> {
  const columns = {
    id: merchantAccounts.id,
    handle: merchantAccounts.handle,
    walletAddress: merchantAccounts.walletAddress,
    businessName: merchantAccounts.businessName,
    userId: merchantAccounts.userId,
  }
  const identity = or(eq(merchantAccounts.userId, userId), eq(merchantAccounts.email, email))

  try {
    const [row] = await db
      .select(columns)
      .from(merchantAccounts)
      .where(and(identity, merchantTenantFilter(caller)))
      .limit(1)
    return row ?? null
  } catch (err) {
    if (caller.scope !== 'service' || !isMissingSchemaObject(err)) throw err
    console.warn('[biashara] merchant_accounts.partner_id not present yet — pre-0067 activation path')
    const [row] = await db.select(columns).from(merchantAccounts).where(identity).limit(1)
    return row ?? null
  }
}

/**
 * Look a merchant up by email for the FIRST-PARTY portal login.
 *
 * Our merchant portal authenticates by email, and email is only unique
 * *within* a tenant now. Without the `partner_id IS NULL` filter, two
 * merchants sharing an email — which the split index deliberately permits —
 * would make `where(email).limit(1)` return an arbitrary one, i.e. a login
 * could land in the wrong tenant's account. Partner-owned merchants sign in
 * through the partner's own app, never here.
 *
 * Pre-0067 the column is absent and the unscoped query is used: correct,
 * because no partner-owned merchant can exist yet for it to confuse.
 */
export async function findFirstPartyMerchantByEmail(email: string) {
  try {
    const [row] = await db
      .select()
      .from(merchantAccounts)
      .where(and(eq(merchantAccounts.email, email), isNull(merchantAccounts.partnerId)))
      .limit(1)
    return row ?? null
  } catch (err) {
    if (!isMissingSchemaObject(err)) throw err
    const [row] = await db.select().from(merchantAccounts).where(eq(merchantAccounts.email, email)).limit(1)
    return row ?? null
  }
}

/**
 * A globally-unique handle. Handles resolve public payment URLs with no tenant
 * context, so a collision cannot be tolerated the way an email collision can —
 * but it also must never surface as an error to the caller. Suffix until free.
 */
export async function reserveHandle(preferred: string, fallbackSuffix: number): Promise<string> {
  const base = preferred.replace(/[^a-z0-9-]/g, '').slice(0, 30) || `merchant${fallbackSuffix}`
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${attempt === 1 ? fallbackSuffix : `${fallbackSuffix}-${attempt}`}`
    const [taken] = await db
      .select({ id: merchantAccounts.id })
      .from(merchantAccounts)
      .where(eq(merchantAccounts.handle, candidate))
      .limit(1)
    if (!taken) return candidate
  }
  // Wallet index is globally unique, so this is guaranteed free.
  return `merchant${fallbackSuffix}`
}
