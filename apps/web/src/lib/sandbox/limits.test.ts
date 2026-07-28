import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import {
  SANDBOX_USER_CAP,
  SANDBOX_PER_TXN_CAP_TZS,
  SANDBOX_DAILY_USER_CAP_TZS,
  SANDBOX_MONTHLY_USER_CAP_TZS,
  checkPerTransactionCap,
  limitErrorResponse,
} from './limits'

describe('BoT sandbox limit constants (Testing Parameters 2–5)', () => {
  it('defaults match the approved testing parameters', () => {
    expect(SANDBOX_USER_CAP).toBe(100) // Para 2: max pilot users
    expect(SANDBOX_PER_TXN_CAP_TZS).toBe(1_000_000) // Para 3: per-transaction cap
    expect(SANDBOX_DAILY_USER_CAP_TZS).toBe(2_000_000) // Para 4: daily user limit
    expect(SANDBOX_MONTHLY_USER_CAP_TZS).toBe(60_000_000) // Para 5: 30-day user cap
  })
})

describe('checkPerTransactionCap (Parameter 3 — TZS 1,000,000 per transaction)', () => {
  it('rejects TZS 1,000,001 (one shilling over the cap)', () => {
    const err = checkPerTransactionCap(1_000_001)
    expect(err).not.toBeNull()
    expect(err?.code).toBe('per_txn_cap')
    expect(err?.limit).toBe(1_000_000)
    expect(err?.requested).toBe(1_000_001)
  })

  it('allows exactly TZS 1,000,000 (cap is inclusive)', () => {
    expect(checkPerTransactionCap(1_000_000)).toBeNull()
  })

  it('allows ordinary amounts', () => {
    expect(checkPerTransactionCap(10_000)).toBeNull()
    expect(checkPerTransactionCap(999_999)).toBeNull()
  })

  it('rejects far-over-cap amounts with the sandbox message', () => {
    const err = checkPerTransactionCap(5_000_000)
    expect(err?.message).toContain('1,000,000')
  })
})

/**
 * The parameters were always ENFORCED, but until drizzle/0069 a block was never
 * RECORDED — so a periodic return to the Bank could assert compliance without
 * evidencing it. A supervisor's question is not "did you set a limit?" but
 * "show me it working."
 *
 * These tests protect the evidence trail: enforcement and recording now happen
 * in one call, and a route cannot do the first without the second.
 */
describe('every enforced cap leaves evidence', () => {
  const APP = path.join(__dirname, '../../app/api')

  /** Routes that legitimately check a cap with no sandbox participant to count against. */
  const EXEMPT: Record<string, string> = {
    'merchant/pay/route.ts':
      'Public payer-facing endpoint — the payer pays a merchant from their own mobile money, so there is no nTZS participant for a period cap. Per-transaction only.',
  }

  function walk(dir: string, base = ''): string[] {
    const out: string[] = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel))
      else if (e.name === 'route.ts') out.push(rel)
    }
    return out
  }

  it('no route enforces a BoT cap without going through enforceSandboxLimits', () => {
    const offenders: string[] = []
    for (const rel of walk(APP)) {
      if (rel in EXEMPT) continue
      const src = fs.readFileSync(path.join(APP, rel), 'utf8')
      const raw = src.includes('checkPerTransactionCap(') || src.includes('checkUserPeriodLimits(')
      if (raw && !src.includes('enforceSandboxLimits(')) {
        offenders.push(`${rel} — rejects on a BoT parameter but leaves no record it bound`)
      }
    }
    expect(
      offenders,
      `Use enforceSandboxLimits(), or add the route to EXEMPT with a reason:\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  it('the recorder is fail-soft, and loud when it fails', () => {
    const src = fs.readFileSync(path.join(__dirname, 'limits.ts'), 'utf8')
    expect(src).toContain('async function recordLimitBlock')
    // Silent non-recording is the exact gap this table closes, so a write
    // failure must be visible in the logs rather than swallowed.
    expect(src).toContain('FAILED to record a limit block')
  })

  it('the error body carries what a partner UI needs to explain the refusal', () => {
    const body = limitErrorResponse({
      code: 'daily_user_cap', message: 'x',
      limit: SANDBOX_DAILY_USER_CAP_TZS, requested: 60_000, used: 1_980_000,
    })
    expect(body.error).toBe('daily_user_cap')
    expect(body.details.limit).toBe(SANDBOX_DAILY_USER_CAP_TZS)
    expect(body.details.usedInPeriod).toBe(1_980_000)
  })

  it('exempt entries all name a real route', () => {
    for (const rel of Object.keys(EXEMPT)) {
      expect(fs.existsSync(path.join(APP, rel)), `EXEMPT lists ${rel}, which does not exist`).toBe(true)
    }
  })
})
