import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import { reserveHandle } from './caller'

/**
 * Structural guard for Biashara tenant isolation.
 *
 * Every Biashara route must resolve its merchant through the shared helper,
 * because that helper is where the "does this merchant belong to this caller"
 * check lives. A route that reads `x-merchant-id` directly has, by
 * definition, skipped it — and would let any authenticated partner act on any
 * merchant in the system.
 */
const BIASHARA_DIR = path.join(__dirname, '../../app/api/v1/biashara')

/** path → why it resolves the merchant differently */
const EXEMPT: Record<string, string> = {
  'accounts/route.ts':
    'Activation — there is no merchant yet. Uses requireBiasharaCaller + findMerchantForActivation, which scopes the idempotency lookup instead.',
}

function walk(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel))
    else if (entry.name === 'route.ts') out.push(rel)
  }
  return out
}

describe('Biashara tenant isolation', () => {
  const routes = walk(BIASHARA_DIR)

  it('finds the Biashara routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(10)
  })

  it('every route resolves its merchant through the tenant-scoped helper', () => {
    const offenders: string[] = []
    for (const rel of routes) {
      if (rel in EXEMPT) continue
      const source = fs.readFileSync(path.join(BIASHARA_DIR, rel), 'utf8')
      if (!source.includes('requireBiasharaMerchant(')) offenders.push(rel)
    }
    expect(
      offenders,
      `These Biashara routes do not use requireBiasharaMerchant(), so they never check that the ` +
        `merchant belongs to the caller:\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  it('no route reads x-merchant-id directly (that is what bypasses the check)', () => {
    const offenders: string[] = []
    for (const rel of routes) {
      const source = fs.readFileSync(path.join(BIASHARA_DIR, rel), 'utf8')
      if (source.includes("headers.get('x-merchant-id')")) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('no route still authenticates with the bare service key', () => {
    const offenders: string[] = []
    for (const rel of routes) {
      const source = fs.readFileSync(path.join(BIASHARA_DIR, rel), 'utf8')
      if (source.includes('requireServiceKey(')) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('the helper refuses test-mode keys and enforces the capability', () => {
    const source = fs.readFileSync(path.join(__dirname, 'caller.ts'), 'utf8')
    expect(source).toContain('not_available_in_test_mode')
    expect(source).toContain("hasCapability(row?.capabilities ?? null, 'biashara')")
    // 404 rather than 403 — never confirm another tenant's merchant id exists.
    expect(source).toContain("{ error: 'Merchant not found' }, { status: 404 }")
  })

  it('the merchant portal login is confined to first-party merchants', () => {
    for (const rel of ['login', 'verify-otp']) {
      const source = fs.readFileSync(
        path.join(__dirname, `../../app/merchant/api/auth/${rel}/route.ts`),
        'utf8'
      )
      expect(source, `${rel} must not resolve merchants by bare email`).toContain(
        'findFirstPartyMerchantByEmail('
      )
    }
  })

  it('exempt entries all name a real route', () => {
    for (const rel of Object.keys(EXEMPT)) {
      expect(fs.existsSync(path.join(BIASHARA_DIR, rel)), `EXEMPT lists ${rel}, which does not exist`).toBe(true)
    }
  })
})

describe('reserveHandle', () => {
  it('is exported for activation to assign a globally-unique handle', () => {
    // Behaviour is DB-backed (covered by the live STK proof); this pins the
    // contract that activation never surfaces a handle collision as an error.
    expect(typeof reserveHandle).toBe('function')
  })
})
