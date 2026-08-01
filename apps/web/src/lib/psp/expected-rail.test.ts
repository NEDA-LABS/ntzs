import { describe, it, expect } from 'vitest'

import { expectedDisbursementRail, expectedPayoutFeeTzs } from './index'

/**
 * 1 Aug 2026: the withdrawal quote charged Snippe's flat 1,500 PSP fee while
 * Selcom — first in DISBURSEMENT_RAIL_PRIORITY — actually served the payout
 * at its 150 tier fee. These pin the fee to the SAME plan sendPayoutRouted
 * walks, gates included, so the quoted price is the serving rail's price.
 */

const ENV = {
  DISBURSEMENT_RAIL_PRIORITY: 'selcom,snippe',
  SELCOM_API_KEY: 'k',
  SELCOM_PRIVATE_KEY: 'p',
  SELCOM_ACCOUNT_NUMBER: 'a',
  SELCOM_DISBURSEMENTS_ENABLED: 'true',
  SNIPPE_API_KEY: 's',
} as unknown as NodeJS.ProcessEnv

describe('expectedDisbursementRail', () => {
  it('is the head of the disbursement plan', () => {
    expect(expectedDisbursementRail(ENV)).toBe('selcom')
  })

  it('honours capability gates — a disabled Selcom cannot be the expected rail', () => {
    expect(expectedDisbursementRail({ ...ENV, SELCOM_DISBURSEMENTS_ENABLED: 'false' })).toBe('snippe')
  })

  it('is null when nothing is configured (never a crash)', () => {
    expect(expectedDisbursementRail({} as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('expectedPayoutFeeTzs', () => {
  it("prices Victor's 1 Aug case correctly: 5,000 TZS on Selcom is 150, not 1,500", () => {
    expect(expectedPayoutFeeTzs(5000, ENV)).toBe(150)
  })

  it('follows the plan head when the priority flips', () => {
    expect(expectedPayoutFeeTzs(5000, { ...ENV, DISBURSEMENT_RAIL_PRIORITY: 'snippe,selcom' })).toBe(1500)
  })

  it('falls back to the legacy flat fee with no rail configured', () => {
    expect(expectedPayoutFeeTzs(5000, {} as NodeJS.ProcessEnv)).toBe(1500)
  })
})
