import type { NextRequest } from 'next/server'

/**
 * Per-partner API source-IP allowlist — the enforcement half (issue #231).
 *
 * Why IP and not "domain": a partner API key is a server-side bearer token.
 * A server can put anything in an Origin or Referer header, so a domain list
 * restrains only honest callers; and /api/v1 sends no CORS headers, so a
 * browser cannot call it cross-origin anyway. The one thing a caller cannot
 * choose freely is the address it connects from — which is why Selcom and
 * AzamPay gate US by IP, and what this offers our partners.
 *
 * Semantics:
 *  - empty/NULL list          → no restriction (opt-in feature)
 *  - non-empty list           → the request's source IP must match an entry
 *  - entries                  → exact IPv4/IPv6, or IPv4 CIDR (a.b.c.d/nn)
 *  - unreadable source IP     → REFUSED when a list is set (fail-closed: an
 *                               allowlist that waves through unattributable
 *                               traffic is not an allowlist)
 *
 * Pure functions; unit-tested without a server.
 */

/** Normalize for comparison: trim, lowercase (IPv6 hex), strip an IPv4-mapped
 *  IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4) so proxies that report mapped
 *  addresses still match plain IPv4 entries. */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase()
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7)
  return ip
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function ipv4ToInt(ip: string): number | null {
  const m = IPV4_RE.exec(ip)
  if (!m) return null
  let out = 0
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i])
    if (octet > 255) return null
    out = out * 256 + octet
  }
  return out
}

/** Loose IPv6 shape check — enough to accept an entry, not a full parser. */
function looksLikeIpv6(ip: string): boolean {
  return ip.includes(':') && /^[0-9a-f:.]+$/.test(ip) && ip.length >= 2
}

export type AllowlistEntry =
  | { kind: 'ip'; value: string }
  | { kind: 'cidr'; base: number; maskBits: number; display: string }

/** Parse one allowlist entry. Returns null for anything invalid — a typo must
 *  be rejected at WRITE time, not silently never-match at request time. */
export function parseAllowlistEntry(raw: string): AllowlistEntry | null {
  const value = normalizeIp(raw)
  if (!value) return null

  const slash = value.indexOf('/')
  if (slash >= 0) {
    const base = ipv4ToInt(value.slice(0, slash))
    const maskBits = Number(value.slice(slash + 1))
    if (base === null || !Number.isInteger(maskBits) || maskBits < 8 || maskBits > 32) return null
    return { kind: 'cidr', base, maskBits, display: value }
  }

  if (ipv4ToInt(value) !== null || looksLikeIpv6(value)) return { kind: 'ip', value }
  return null
}

/** Does `ip` match `entry`? */
function entryMatches(entry: AllowlistEntry, ip: string): boolean {
  if (entry.kind === 'ip') return entry.value === ip
  const asInt = ipv4ToInt(ip)
  if (asInt === null) return false
  const mask = entry.maskBits === 0 ? 0 : (~0 << (32 - entry.maskBits)) >>> 0
  return ((asInt & mask) >>> 0) === ((entry.base & mask) >>> 0)
}

export function ipAllowed(list: string[] | null | undefined, sourceIp: string | null): boolean {
  if (!list || list.length === 0) return true
  if (!sourceIp) return false
  const ip = normalizeIp(sourceIp)
  for (const raw of list) {
    const entry = parseAllowlistEntry(raw)
    if (entry && entryMatches(entry, ip)) return true
  }
  return false
}

/**
 * The request's source address, as established by the PLATFORM, not the caller.
 *
 * On Vercel the edge sets x-real-ip and rewrites x-forwarded-for from the
 * actual connection — inbound values a client sends are replaced, so the
 * leftmost entry is trustworthy THERE. Self-hosted deployments must ensure the
 * same at their proxy; the header order here assumes it.
 */
export function requestSourceIp(request: NextRequest): string | null {
  const real = request.headers.get('x-real-ip')
  if (real) return normalizeIp(real)
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return normalizeIp(first)
  }
  return null
}
