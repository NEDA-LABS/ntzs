import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import { ipAllowed, normalizeIp, parseAllowlistEntry } from './ip-allowlist'

/**
 * Issue #231 — a partner's API key restricted to their servers' addresses.
 *
 * Two ways this feature can hurt someone: let a thief through (matching too
 * loosely) or lock the legitimate partner out (matching too strictly, or
 * letting a typo into the list). The tests cover both directions.
 */

describe('entry validation — a typo must fail at write time, not at 3am', () => {
  it('accepts real shapes', () => {
    expect(parseAllowlistEntry('41.59.226.10')).toEqual({ kind: 'ip', value: '41.59.226.10' })
    expect(parseAllowlistEntry(' 41.59.226.0/24 ')?.kind).toBe('cidr')
    expect(parseAllowlistEntry('2600:1f18:22ba::1')?.kind).toBe('ip')
  })

  it('rejects everything else by name', () => {
    for (const bad of ['nedapay.xyz', '41.59.226', '41.59.226.256', '41.59.226.0/7', '41.59.226.0/33', '', 'not-an-ip']) {
      expect(parseAllowlistEntry(bad), `'${bad}' must be rejected`).toBeNull()
    }
  })

  it('rejects over-broad CIDR blocks — /7 would allowlist half the internet', () => {
    expect(parseAllowlistEntry('10.0.0.0/8')?.kind).toBe('cidr')
    expect(parseAllowlistEntry('10.0.0.0/7')).toBeNull()
  })
})

describe('matching', () => {
  it('empty list = no restriction (the feature is opt-in)', () => {
    expect(ipAllowed([], '1.2.3.4')).toBe(true)
    expect(ipAllowed(null, '1.2.3.4')).toBe(true)
    expect(ipAllowed(undefined, null)).toBe(true)
  })

  it('exact IPv4 match', () => {
    expect(ipAllowed(['41.59.226.10'], '41.59.226.10')).toBe(true)
    expect(ipAllowed(['41.59.226.10'], '41.59.226.11')).toBe(false)
  })

  it('CIDR match respects the boundary exactly', () => {
    const list = ['41.59.226.0/24']
    expect(ipAllowed(list, '41.59.226.1')).toBe(true)
    expect(ipAllowed(list, '41.59.226.255')).toBe(true)
    expect(ipAllowed(list, '41.59.227.0')).toBe(false)
  })

  it('an IPv4-mapped IPv6 source still matches its IPv4 entry', () => {
    // Proxies report ::ffff:a.b.c.d; failing to strip it would lock out a
    // partner whose list is plainly correct.
    expect(ipAllowed(['41.59.226.10'], '::ffff:41.59.226.10')).toBe(true)
    expect(normalizeIp('::FFFF:41.59.226.10')).toBe('41.59.226.10')
  })

  it('with a list set, an unattributable source is REFUSED', () => {
    // Fail-closed: an allowlist that waves through requests whose address
    // cannot be established is not an allowlist.
    expect(ipAllowed(['41.59.226.10'], null)).toBe(false)
    expect(ipAllowed(['41.59.226.10'], '')).toBe(false)
  })

  it('an invalid stored entry never matches anything (defence in depth)', () => {
    expect(ipAllowed(['garbage'], 'garbage')).toBe(false)
  })
})

describe('the guarantees that make the feature safe to hold', () => {
  const WEB = path.join(__dirname, '../..')
  const read = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8')

  it('enforced inside authenticatePartner, so no /api/v1 route can forget it', () => {
    const auth = read('lib/waas/auth.ts')
    expect(auth).toContain('partnerIpAllowlist(partner.id)')
    expect(auth).toContain('ip_not_allowed')
  })

  it('the 403 names the caller its own address — the fact needed to fix the list', () => {
    expect(read('lib/waas/auth.ts')).toContain('this request came from ${sourceIp')
  })

  it('management is SESSION auth only — a stolen API key cannot edit the list', () => {
    const route = read('app/api/v1/partners/ip-allowlist/route.ts')
    expect(route).toContain('verifyPartnerSession')
    // The bearer-key path must not appear anywhere in the management route.
    expect(route).not.toContain('authenticatePartner')
    expect(route).not.toContain('Bearer')
  })

  it('a bad entry rejects the whole save, named, instead of a silent lockout later', () => {
    expect(read('app/api/v1/partners/ip-allowlist/route.ts')).toContain('invalid_entry')
  })

  it('before migration 0080 the column reads as no-restriction, never as an error', () => {
    expect(read('lib/waas/auth.ts')).toContain('ipAllowlistColumnMissing')
  })
})
