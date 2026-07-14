import { describe, it, expect } from 'vitest'

import {
  SANDBOX_USER_CAP,
  SANDBOX_PER_TXN_CAP_TZS,
  SANDBOX_DAILY_USER_CAP_TZS,
  SANDBOX_MONTHLY_USER_CAP_TZS,
  checkPerTransactionCap,
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
