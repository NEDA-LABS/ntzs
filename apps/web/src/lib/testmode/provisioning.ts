import { and, eq, gte, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { generateWebhookSecret, hashApiKey } from '@/lib/waas/auth'
import { partners } from '@ntzs/db'

import { generateTestApiKey, testModeSignupDailyCap } from './mode'

/**
 * Provisioning for test partners.
 *
 * A test partner is a `partners` row with mode='test' and — deliberately — NO
 * encrypted HD seed and NO treasury address. It therefore cannot derive a real
 * wallet or receive a real fee mint even if a code path were to try: the
 * material simply is not there. That is the second layer under the route-level
 * branch.
 */

export type ProvisionResult =
  | { ok: true; partnerId: string; apiKey: string; webhookSecret: string; created: boolean }
  | { ok: false; code: 'migration_pending' | 'daily_cap' | 'exists'; message: string }

const MIGRATION_PENDING: ProvisionResult = {
  ok: false,
  code: 'migration_pending',
  message: 'Test mode is not available on this deployment yet (pending database migration).',
}

function isUndefinedColumn(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  if (code === '42703' || code === '42P01') return true
  const message = err instanceof Error ? err.message : String(err)
  return /(column|relation) .* does not exist/i.test(message)
}

/**
 * Create a test partner. `livePartnerId` links it to the live account that
 * asked for it (null for a self-serve sandbox-only signup).
 *
 * Idempotent by email: an existing test partner is never silently duplicated —
 * the caller decides whether to rotate its key.
 */
export async function createTestPartner(args: {
  name: string
  email: string
  webhookUrl?: string | null
  livePartnerId?: string | null
  /** Enforce the anti-abuse ceiling (public signup only). */
  enforceDailyCap?: boolean
}): Promise<ProvisionResult> {
  const { db } = getDb()
  const apiKey = generateTestApiKey()
  const webhookSecret = generateWebhookSecret()

  try {
    const [existing] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.email, args.email))
      .limit(1)
    if (existing) {
      return {
        ok: false,
        code: 'exists',
        message: 'An account with this email already exists — sign in to the developer dashboard to get its test key.',
      }
    }

    if (args.enforceDailyCap) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(partners)
        .where(and(eq(partners.mode, 'test'), gte(partners.createdAt, since)))
      if (count >= testModeSignupDailyCap()) {
        return {
          ok: false,
          code: 'daily_cap',
          message: 'Too many sandbox accounts created today. Try again tomorrow or contact us for a key.',
        }
      }
    }

    const [row] = await db
      .insert(partners)
      .values({
        name: args.name,
        email: args.email,
        apiKeyHash: hashApiKey(apiKey),
        apiKeyPrefix: apiKey.slice(0, 14),
        webhookUrl: args.webhookUrl ?? null,
        webhookSecret,
        // No HD seed, no treasury: a test partner has nothing to sign with.
        encryptedHdSeed: null,
        treasuryWalletAddress: null,
        // Explicit, and deliberately WITHOUT 'ramp': leaving this null would
        // resolve to the legacy "all capabilities" default, which includes the
        // cross-border rail. Ramp is refused for test keys anyway
        // (requireRampPartner), but the grant should not exist in the first place.
        capabilities: ['wallets', 'collections', 'disbursements', 'transfers', 'treasury'],
        isActive: true,
        mode: 'test',
        livePartnerId: args.livePartnerId ?? null,
      })
      .returning({ id: partners.id })

    return { ok: true, partnerId: row.id, apiKey, webhookSecret, created: true }
  } catch (err) {
    if (isUndefinedColumn(err)) return MIGRATION_PENDING
    throw err
  }
}

/** The test partner paired with a live partner, if one has been issued. */
export async function findPairedTestPartner(
  livePartnerId: string
): Promise<{ id: string; apiKeyPrefix: string | null; webhookUrl: string | null } | null | 'migration_pending'> {
  const { db } = getDb()
  try {
    const [row] = await db
      .select({ id: partners.id, apiKeyPrefix: partners.apiKeyPrefix, webhookUrl: partners.webhookUrl })
      .from(partners)
      .where(and(eq(partners.livePartnerId, livePartnerId), eq(partners.mode, 'test')))
      .limit(1)
    return row ?? null
  } catch (err) {
    if (isUndefinedColumn(err)) return 'migration_pending'
    throw err
  }
}

/** Mint a fresh key for an existing test partner (the old one stops working). */
export async function rotateTestKey(testPartnerId: string): Promise<{ apiKey: string }> {
  const { db } = getDb()
  const apiKey = generateTestApiKey()
  await db
    .update(partners)
    .set({ apiKeyHash: hashApiKey(apiKey), apiKeyPrefix: apiKey.slice(0, 14), updatedAt: new Date() })
    .where(eq(partners.id, testPartnerId))
  return { apiKey }
}
