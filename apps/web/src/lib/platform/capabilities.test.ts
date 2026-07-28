import { describe, it, expect } from 'vitest'

import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  OPT_IN_CAPABILITIES,
  hasCapability,
  resolveCapabilities,
} from './capabilities'

/**
 * Regression test for the legacy-default back door.
 *
 * `capabilities IS NULL` means "legacy partner → everything", so that nothing an
 * existing partner already uses can disappear. Adding `biashara` to the enum
 * therefore granted a live merchant product — wallets, collections, cash-out,
 * working capital — to every partner holding a NULL row, without anyone
 * deciding to. Shipped in #183, caught and closed immediately after.
 *
 * The rule: a NEW capability must be opt-in. These tests exist so that adding
 * the next one has to be a deliberate choice rather than an accident.
 */
describe('capability resolution', () => {
  it('does NOT grant opt-in capabilities to legacy partners (the back door)', () => {
    const legacy = resolveCapabilities(null)
    for (const cap of OPT_IN_CAPABILITIES) {
      expect(legacy, `${cap} must never be implied by the legacy NULL default`).not.toContain(cap)
      expect(hasCapability(null, cap)).toBe(false)
      expect(hasCapability([], cap)).toBe(false)
    }
  })

  it('still grants every non-opt-in capability to legacy partners', () => {
    const legacy = resolveCapabilities(null)
    for (const cap of ALL_CAPABILITIES) {
      if (OPT_IN_CAPABILITIES.includes(cap)) continue
      expect(legacy, `${cap} is pre-existing and must not be revoked from legacy partners`).toContain(cap)
    }
    // Empty array is the same legacy signal as NULL.
    expect(resolveCapabilities([])).toEqual(legacy)
  })

  it('grants an opt-in capability only on an explicit list', () => {
    expect(hasCapability(['biashara'], 'biashara')).toBe(true)
    expect(hasCapability(['wallets', 'biashara'], 'biashara')).toBe(true)
    expect(hasCapability(['wallets'], 'biashara')).toBe(false)
  })

  it('ignores unknown capability strings rather than trusting them', () => {
    expect(resolveCapabilities(['wallets', 'not-a-capability'])).toEqual(['wallets'])
  })

  it('every opt-in capability is a real capability that requires KYB', () => {
    for (const cap of OPT_IN_CAPABILITIES) {
      expect(cap in CAPABILITIES).toBe(true)
      // Opt-in exists because the capability moves money on someone's behalf.
      expect(CAPABILITIES[cap].kybRequired, `${cap} is opt-in, so it should require KYB`).toBe(true)
    }
  })
})

describe('biashara enforcement', () => {
  it('is gated on BOTH the capability and approved KYB', async () => {
    // kybRequired is metadata; something has to enforce it. Ramp does, and
    // Biashara must too — otherwise the declaration is decorative.
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.join(__dirname, '../biashara/caller.ts'), 'utf8')
    expect(source).toContain("hasCapability(row?.capabilities ?? null, 'biashara')")
    expect(source).toContain('partnerKyb')
    expect(source).toContain("kyb.status !== 'approved'")
  })
})
