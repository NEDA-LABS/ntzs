import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

/**
 * THE structural guard for test mode.
 *
 * Every v1 route that authenticates a partner must decide, explicitly, what a
 * TEST key does — otherwise a future route silently sends simulated traffic
 * into the chain / a PSP / the money tables, which is the one failure this
 * whole subsystem exists to prevent.
 *
 * A route satisfies the rule by calling `isTestMode(...)`, or by appearing in
 * EXEMPT below with a reason. Adding a route and forgetting both fails CI.
 */

const V1_DIR = path.join(__dirname, '../../app/api/v1')

/** path (relative to api/v1) → why it needs no test-mode branch */
const EXEMPT: Record<string, string> = {
  'supply/route.ts': 'Read-only public chain data (total nTZS supply) — identical answer in either mode.',
  'reconcile/route.ts': 'Read-only reconciliation of public on-chain supply — no partner-scoped state.',
  'testmode/signup/route.ts': 'Unauthenticated: it issues the test key rather than consuming one.',
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

describe('test-mode route coverage', () => {
  const routes = walk(V1_DIR)

  it('finds the v1 routes', () => {
    expect(routes.length).toBeGreaterThan(10)
  })

  it('every partner-authenticated v1 route handles test mode (or is explicitly exempt)', () => {
    const missing: string[] = []

    for (const rel of routes) {
      const source = fs.readFileSync(path.join(V1_DIR, rel), 'utf8')
      const authenticates = source.includes('authenticatePartner(') || source.includes('requireRampPartner(')
      if (!authenticates) continue
      if (rel in EXEMPT) continue
      if (source.includes('isTestMode(')) continue
      // Ramp routes inherit the branch from their shared auth wrapper, which
      // refuses test keys outright — verified below.
      if (source.includes('requireRampPartner(')) continue
      missing.push(rel)
    }

    expect(
      missing,
      `These v1 routes authenticate a partner but never branch on test mode. Add ` +
        `\`if (isTestMode(partner)) return <handler>\` immediately after auth, or add the route to ` +
        `EXEMPT in this test with a reason:\n  ${missing.join('\n  ')}`
    ).toEqual([])
  })

  it('the test-mode branch comes BEFORE any money code', () => {
    // The branch is only a guarantee if nothing money-shaped runs above it.
    const MONEY_MARKERS = ['ethers.Contract', 'sendPayout(', 'initiateCollection(', 'dispatchSpendPayment(']
    const offenders: string[] = []

    for (const rel of routes) {
      const source = fs.readFileSync(path.join(V1_DIR, rel), 'utf8')
      const branchAt = source.indexOf('isTestMode(')
      if (branchAt === -1) continue
      for (const marker of MONEY_MARKERS) {
        const at = source.indexOf(marker)
        // Ignore markers that appear before the branch only as imports/ABI
        // constants at module scope — those are declarations, not execution.
        if (at !== -1 && at < branchAt && source.slice(at, branchAt).includes('await ')) {
          offenders.push(`${rel} (${marker} executes before the test-mode branch)`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('the shared ramp auth wrapper refuses test keys', () => {
    // Ramp moves cross-border money and is BoT-gated — it must never be
    // simulated. Every ramp route delegates to this one helper, so the guard
    // has to live (and stay) here.
    const source = fs.readFileSync(path.join(__dirname, '../ramp/auth.ts'), 'utf8')
    expect(source).toContain('isTestMode(')
    expect(source).toContain('not_available_in_test_mode')
  })

  it('exempt entries all name a real route', () => {
    for (const rel of Object.keys(EXEMPT)) {
      expect(fs.existsSync(path.join(V1_DIR, rel)), `EXEMPT lists ${rel}, which does not exist`).toBe(true)
    }
  })
})
