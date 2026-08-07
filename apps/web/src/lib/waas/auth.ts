/**
 * WaaS Partner API Key Authentication
 * Extracts Bearer token from Authorization header, hashes it,
 * and looks up the partner in the DB.
 */

import crypto from 'crypto'
import { eq, type SQL } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { isMissingSchemaObject } from '@/lib/db-errors'
import { normalizeMode, type PartnerMode } from '@/lib/testmode/mode'
import { partners } from '@ntzs/db'

import { ipAllowed, requestSourceIp } from '@/lib/waas/ip-allowlist'

export interface AuthenticatedPartner {
  id: string
  name: string
  webhookUrl: string | null
  webhookSecret: string | null
  encryptedHdSeed: string | null
  nextWalletIndex: number
  /**
   * Developer TEST MODE (see lib/testmode/). 'test' traffic is served by the
   * simulator and never reaches the chain, a PSP, or a money table. Reads as
   * 'live' on any deployment where drizzle/0066_test_mode.sql is not applied.
   */
  mode: PartnerMode
  /** On a test partner, the live partner it was issued for. */
  livePartnerId: string | null
}

const PARTNER_COLUMNS = {
  id: partners.id,
  name: partners.name,
  webhookUrl: partners.webhookUrl,
  webhookSecret: partners.webhookSecret,
  encryptedHdSeed: partners.encryptedHdSeed,
  nextWalletIndex: partners.nextWalletIndex,
  isActive: partners.isActive,
}

type PartnerRow = {
  id: string
  name: string
  webhookUrl: string | null
  webhookSecret: string | null
  encryptedHdSeed: string | null
  nextWalletIndex: number
  isActive: boolean
  mode: string | null
  livePartnerId: string | null
}

/**
 * Deploy-order safety: `partners.mode` / `partners.live_partner_id` arrive with
 * drizzle/0066_test_mode.sql, which is applied by hand. A deploy that lands
 * before the migration must not 500 every partner API call, so the first
 * "column does not exist" answer latches a fallback that treats every partner
 * as live — i.e. exactly today's behaviour — for the life of the process.
 *
 * The predicate MUST unwrap drizzle's error wrapper (see lib/db-errors.ts).
 * A version of this that only inspected the top-level error shipped on
 * 27 Jul 2026 and never latched, so the window it was written to cover
 * returned 500s instead.
 */
let modeColumnsMissing = false

async function selectPartner(where: SQL): Promise<PartnerRow | null> {
  const { db } = getDb()

  if (!modeColumnsMissing) {
    try {
      const [row] = await db
        .select({ ...PARTNER_COLUMNS, mode: partners.mode, livePartnerId: partners.livePartnerId })
        .from(partners)
        .where(where)
        .limit(1)
      return row ?? null
    } catch (err) {
      if (!isMissingSchemaObject(err)) throw err
      modeColumnsMissing = true
      console.warn('[waas/auth] partners.mode not present yet — treating all partners as live until 0066 is applied')
    }
  }

  const [row] = await db.select(PARTNER_COLUMNS).from(partners).where(where).limit(1)
  return row ? { ...row, mode: 'live', livePartnerId: null } : null
}

function toAuthenticated(row: PartnerRow): AuthenticatedPartner {
  return {
    id: row.id,
    name: row.name,
    webhookUrl: row.webhookUrl,
    webhookSecret: row.webhookSecret,
    encryptedHdSeed: row.encryptedHdSeed,
    nextWalletIndex: row.nextWalletIndex,
    mode: normalizeMode(row.mode),
    livePartnerId: row.livePartnerId,
  }
}

/**
 * Hash an API key using SHA-256 for storage/lookup
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex')
}

/** Fixed prefix on every partner webhook signing secret. */
export const WEBHOOK_SECRET_PREFIX = 'whsec_'

/**
 * Mint a partner webhook signing secret (`whsec_` + 48 hex chars).
 *
 * Unlike the API key — which we only ever store hashed — this secret is kept in
 * plaintext because the server must read it back to HMAC-sign every outbound
 * webhook (see partner-webhooks.ts). Single source of truth for the format,
 * shared by signup, enterprise provisioning, and dashboard rotation.
 */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${crypto.randomBytes(24).toString('hex')}`
}

/**
 * Resolve the HMAC secret used to sign partner sessions.
 * Fails closed when APP_SECRET is missing / too short to prevent any
 * deployment from silently falling back to a guessable default.
 */
function getAppSecret(): string {
  const secret = process.env.APP_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'APP_SECRET is not configured (must be set to a random string of at least 32 characters)'
    )
  }
  return secret
}

export const PARTNER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PARTNER_SESSION_COOKIE = 'partner_session'

/**
 * Sign a partner session token. `exp` is always included.
 */
export function signSessionToken(partnerId: string, ttlMs: number = PARTNER_SESSION_TTL_MS): string {
  const secret = getAppSecret()
  const payload = JSON.stringify({ pid: partnerId, exp: Date.now() + ttlMs })
  const encoded = Buffer.from(payload).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

/**
 * Verify a partner session token and return the partner ID if valid.
 * Requires a numeric `exp` claim — tokens without one are rejected.
 */
export function verifySessionToken(token: string): string | null {
  let secret: string
  try {
    secret = getAppSecret()
  } catch {
    // Fail closed: if the server is misconfigured, no session is valid.
    return null
  }

  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, sig] = parts
  if (!encoded || !sig) return null

  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
  const sigBuf = Buffer.from(sig, 'utf8')
  const expBuf = Buffer.from(expectedSig, 'utf8')
  if (sigBuf.length !== expBuf.length) return null
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (typeof payload.pid !== 'string' || !payload.pid) return null
    return payload.pid
  } catch {
    return null
  }
}

/**
 * Verify a partner session and return the partner info if valid
 */
export async function verifyPartnerSession(token: string): Promise<AuthenticatedPartner | null> {
  const partnerId = verifySessionToken(token)
  if (!partnerId) return null

  const partner = await selectPartner(eq(partners.id, partnerId))
  if (!partner || !partner.isActive) return null

  return toAuthenticated(partner)
}

/**
 * Authenticate a partner from the request's Authorization header.
 * Returns the partner if valid, or a NextResponse error.
 */
/** The partner's API IP allowlist, read tolerantly: before drizzle/0080 the
 * column does not exist, which reads as "no restriction" — correct for an
 * opt-in control that nobody can have configured yet. */
let ipAllowlistColumnMissing = false
async function partnerIpAllowlist(partnerId: string): Promise<string[] | null> {
  if (ipAllowlistColumnMissing) return null
  const { db } = getDb()
  try {
    const [row] = await db
      .select({ list: partners.apiIpAllowlist })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1)
    return row?.list ?? null
  } catch (err) {
    if (!isMissingSchemaObject(err)) throw err
    ipAllowlistColumnMissing = true
    console.warn('[waas/auth] partners.api_ip_allowlist not present yet — no IP restriction until 0080 is applied')
    return null
  }
}

export async function authenticatePartner(
  request: NextRequest
): Promise<{ partner: AuthenticatedPartner } | { error: NextResponse }> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: NextResponse.json(
        { error: 'Missing or invalid Authorization header. Expected: Bearer <api_key>' },
        { status: 401 }
      ),
    }
  }

  const apiKey = authHeader.slice(7) // Remove "Bearer "
  if (!apiKey) {
    return {
      error: NextResponse.json({ error: 'Empty API key' }, { status: 401 }),
    }
  }

  const keyHash = hashApiKey(apiKey)
  const partner = await selectPartner(eq(partners.apiKeyHash, keyHash))

  if (!partner) {
    return {
      error: NextResponse.json({ error: 'Invalid API key' }, { status: 401 }),
    }
  }

  if (!partner.isActive) {
    return {
      error: NextResponse.json({ error: 'Partner account is deactivated' }, { status: 403 }),
    }
  }

  // ── Source-IP allowlist (issue #231, opt-in) ──────────────────────────────
  // Enforced INSIDE authentication so no /api/v1 route can forget it. The 403
  // names the caller's own address — that is the one piece of information the
  // legitimate integrator needs to fix their list, and it is information the
  // caller already has about itself.
  const allowlist = await partnerIpAllowlist(partner.id)
  if (allowlist && allowlist.length > 0) {
    const sourceIp = requestSourceIp(request)
    if (!ipAllowed(allowlist, sourceIp)) {
      console.warn(`[waas/auth] IP refused for partner ${partner.id}: ${sourceIp ?? 'unattributable'}`)
      return {
        error: NextResponse.json(
          {
            error: `This API key is restricted to approved IP addresses, and this request came from ${sourceIp ?? 'an address that could not be established'}. Add it in the developer dashboard (Settings → API IP allowlist) or call from an approved server.`,
            code: 'ip_not_allowed',
            sourceIp: sourceIp ?? null,
          },
          { status: 403 }
        ),
      }
    }
  }

  return { partner: toAuthenticated(partner) }
}
