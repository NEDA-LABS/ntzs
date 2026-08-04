import { execFileSync } from 'child_process'
import path from 'path'

import { describe, it, expect } from 'vitest'

import {
  SAFE_MINT_THRESHOLD_TZS,
  SAFE_BURN_THRESHOLD_TZS,
  DEFAULT_APPROVAL_THRESHOLD_TZS,
  mintStatusForAmount,
} from './thresholds'

/**
 * 3 Aug 2026 — deposits of 100,000+ were being parked for multi-sig approval
 * against a policy cap of 1,000,000. Cause was not a wrong number but TWELVE
 * copies of it: nine sites said 1,000,000, five still said 100,000. A deposit
 * settled by a PSP webhook took the 1,000,000 branch; the same deposit settled
 * by the fallback poll cron took the 100,000 branch. The control was decided
 * by whichever observer saw the payment first.
 *
 * The value tests are cheap. The one that matters is the LAST one: it fails
 * the build if anyone reintroduces a local copy.
 */

const SRC = path.join(__dirname, '../..')

describe('approval thresholds', () => {
  it('default to the policy cap of 1,000,000 TZS on both sides', () => {
    expect(DEFAULT_APPROVAL_THRESHOLD_TZS).toBe(1_000_000)
    expect(SAFE_MINT_THRESHOLD_TZS).toBe(1_000_000)
    expect(SAFE_BURN_THRESHOLD_TZS).toBe(1_000_000)
  })

  it('routes deposits by amount — the boundary is inclusive', () => {
    expect(mintStatusForAmount(100_000)).toBe('mint_pending')
    expect(mintStatusForAmount(999_999)).toBe('mint_pending')
    expect(mintStatusForAmount(1_000_000)).toBe('mint_requires_safe')
    expect(mintStatusForAmount(1_000_001)).toBe('mint_requires_safe')
  })

  it('a garbage or zero override falls back rather than sending everything to multi-sig', async () => {
    // A zero/NaN threshold would make EVERY deposit require a Safe signature —
    // a config typo must not become an outage.
    const mod = await import('./thresholds')
    const read = (raw: string | undefined, fallback: number) => {
      const n = Number(raw)
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback
    }
    expect(read(undefined, 1_000_000)).toBe(1_000_000)
    expect(read('', 1_000_000)).toBe(1_000_000)
    expect(read('0', 1_000_000)).toBe(1_000_000)
    expect(read('-5', 1_000_000)).toBe(1_000_000)
    expect(read('abc', 1_000_000)).toBe(1_000_000)
    expect(read('2500000', 1_000_000)).toBe(2_500_000)
    expect(mod.SAFE_MINT_THRESHOLD_TZS).toBeGreaterThan(0)
  })

  it('NO file re-declares the threshold locally — one definition, always', () => {
    // The actual bug: `const SAFE_MINT_THRESHOLD_TZS = 100000` pasted into a
    // route. Any local re-declaration is the defect, whatever value it holds.
    let out = ''
    try {
      out = execFileSync(
        'grep',
        [
          '-rn',
          '--include=*.ts',
          '--include=*.tsx',
          '-E',
          '^\\s*(export )?const SAFE_(MINT|BURN|APPROVAL)_THRESHOLD_TZS\\s*=',
          SRC,
        ],
        { encoding: 'utf8' }
      )
    } catch {
      out = '' // grep exits 1 when nothing matches — that is the pass case
    }
    const offenders = out
      .split('\n')
      .filter(Boolean)
      // The canonical definitions in this module are the only allowed ones.
      .filter((line) => !line.includes(path.join('lib', 'approvals', 'thresholds.ts')))
    expect(offenders, `local threshold copies found:\n${offenders.join('\n')}`).toEqual([])
  })

  it('every deposit-settling path imports the shared constant', () => {
    // These are the observers that can advance a deposit to a mint status.
    // If one stops importing, it has grown its own opinion again.
    const out = execFileSync(
      'grep',
      ['-rl', '--include=*.ts', '--include=*.tsx', 'SAFE_MINT_THRESHOLD_TZS', SRC],
      { encoding: 'utf8' }
    )
    for (const settler of [
      'webhooks/snippe/payment',
      'webhooks/selcom/payment',
      'webhooks/azampay/payment',
      'cron/poll-snippe',
      'cron/poll-selcom',
      'cron/poll-azampay',
      'cron/selcom-statement-sync',
      'backstage/minting',
    ]) {
      expect(out, `${settler} no longer references the shared mint threshold`).toContain(settler)
    }
  })
})
