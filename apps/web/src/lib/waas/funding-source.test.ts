import fs from 'fs'
import path from 'path'

import { describe, it, expect, afterEach } from 'vitest'

import { fundingSourceKey, wakalaFloatEnabled, type FundingSource } from './funding-source'
import { OPT_IN_CAPABILITIES } from '@/lib/platform/capabilities'

const SAVED = process.env.WAKALA_FLOAT_ENABLED
afterEach(() => {
  if (SAVED === undefined) delete process.env.WAKALA_FLOAT_ENABLED
  else process.env.WAKALA_FLOAT_ENABLED = SAVED
})

const userSource: FundingSource = {
  kind: 'user',
  address: '0xabc',
  subject: { kind: 'user', id: 'u-1' },
  userId: 'u-1',
  walletId: 'w-1',
  externalId: 'ext-1',
}
const floatSource: FundingSource = {
  kind: 'sub_wallet',
  address: '0xdef',
  subject: { kind: 'sub_wallet', id: 'sw-1' },
  subWalletId: 'sw-1',
  label: 'Agent 42',
  userId: 'treasury-user',
  walletId: 'treasury-wallet',
}

describe('funding source', () => {
  it('keys the two source kinds distinctly, so a quote cannot be replayed across them', () => {
    expect(fundingSourceKey(userSource)).toBe('user:u-1')
    expect(fundingSourceKey(floatSource)).toBe('sub_wallet:sw-1')
    expect(fundingSourceKey(userSource)).not.toBe(fundingSourceKey(floatSource))
  })

  it('is off unless explicitly enabled', () => {
    delete process.env.WAKALA_FLOAT_ENABLED
    expect(wakalaFloatEnabled()).toBe(false)
    process.env.WAKALA_FLOAT_ENABLED = 'false'
    expect(wakalaFloatEnabled()).toBe(false)
    process.env.WAKALA_FLOAT_ENABLED = 'TRUE'
    expect(wakalaFloatEnabled()).toBe(false) // exact match only
    process.env.WAKALA_FLOAT_ENABLED = 'true'
    expect(wakalaFloatEnabled()).toBe(true)
  })

  it('requires an explicit capability grant — never implied by the legacy default', () => {
    expect(OPT_IN_CAPABILITIES).toContain('wakala')
  })
})

/**
 * ⚠ THE COMPLIANCE INVARIANT.
 *
 * Sub-wallets sit under a partner treasury, so `checkUserPeriodLimits` never
 * sees them. A disbursement route that accepts `subWalletId` and then calls the
 * USER checker would let an agent float run unlimited daily volume — a route
 * around BoT Parameters #4/#5. Every such route must count against the funding
 * source's own subject instead.
 *
 * This test is the thing standing between "capability" and "cap evasion".
 */
describe('sandbox caps follow the funding source', () => {
  const V1 = path.join(__dirname, '../../app/api/v1')

  function walk(dir: string, base = ''): string[] {
    const out: string[] = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel))
      else if (e.name === 'route.ts') out.push(rel)
    }
    return out
  }

  it('no route accepts subWalletId while counting caps against a user', () => {
    const offenders: string[] = []
    for (const rel of walk(V1)) {
      const src = fs.readFileSync(path.join(V1, rel), 'utf8')
      if (!src.includes('subWalletId')) continue
      if (!src.includes('checkFundingSourcePeriodLimits')) {
        offenders.push(`${rel} — accepts subWalletId but does not use checkFundingSourcePeriodLimits`)
      }
      if (src.includes('checkUserPeriodLimits(')) {
        offenders.push(`${rel} — still calls checkUserPeriodLimits, which cannot see a sub-wallet`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every sub-wallet funded burn is tagged with its float (the cap subject)', () => {
    const src = fs.readFileSync(path.join(V1, 'spend/route.ts'), 'utf8')
    expect(src).toContain('subWalletId: source.subWalletId')
    expect(src).toContain('burnFromAddress: source.address')
  })

  it('the per-float checker counts burns against the sub-wallet, not the user', () => {
    const src = fs.readFileSync(path.join(__dirname, '../sandbox/limits.ts'), 'utf8')
    expect(src).toContain('checkSubWalletPeriodLimits')
    expect(src).toContain('eq(burnRequests.subWalletId, subWalletId)')
    // Same statutory ceilings — a float gets no more headroom than a person.
    expect(src).toContain('SANDBOX_DAILY_USER_CAP_TZS')
    expect(src).toContain('SANDBOX_MONTHLY_USER_CAP_TZS')
  })
})
