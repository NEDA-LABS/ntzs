import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'

import {
  depositOutcome,
  payoutOutcome,
  testKycStatus,
  testRecipientName,
  testTxHash,
  testWalletAddress,
  testReceipt,
  TEST_SCENARIOS,
} from './scenarios'
import { statusForOutcome } from './engine'

describe('test-mode scenarios — the last two digits decide the outcome', () => {
  it('deposits are driven by the amount', () => {
    expect(depositOutcome(10_000)).toBe('complete')
    expect(depositOutcome(5_013)).toBe('fail')
    expect(depositOutcome(7_502)).toBe('reconcile')
    expect(depositOutcome(1_099)).toBe('hang')
  })

  it('payouts are driven by the destination — phone, till or bill reference alike', () => {
    expect(payoutOutcome('255744277496')).toBe('complete')
    expect(payoutOutcome('255744277413')).toBe('fail')
    expect(payoutOutcome('61115502')).toBe('reconcile')
    expect(payoutOutcome('01234567899')).toBe('hang')
  })

  it('ignores non-digits so formatted numbers behave the same', () => {
    expect(payoutOutcome('+255 744 277 413')).toBe('fail')
    expect(payoutOutcome('0744-277-413')).toBe('fail')
  })

  it('maps outcomes to the terminal status the API reports', () => {
    expect(statusForOutcome('complete')).toBe('completed')
    expect(statusForOutcome('fail')).toBe('failed')
    expect(statusForOutcome('reconcile')).toBe('reconcile_required')
    // 'hang' is the one outcome that never becomes terminal.
    expect(statusForOutcome('hang')).toBe('pending')
  })
})

describe('name lookup', () => {
  it('resolves the two real production tills used in demos', () => {
    expect(testRecipientName('61115582')).toBe('ENZI COFFEE COMPANY LIMITED')
    expect(testRecipientName('70031820')).toBe('NEDA LABS LIMITED')
  })

  it('has no name for a destination ending 00 (the unverifiable branch)', () => {
    expect(testRecipientName('255744277400')).toBeNull()
  })

  it('is deterministic and non-empty otherwise', () => {
    const a = testRecipientName('255744277496')
    const b = testRecipientName('255744277496')
    expect(a).toBeTruthy()
    expect(a).toBe(b)
  })
})

describe('simulated identity', () => {
  it('sends NIDA ending 0000 to manual review and approves everything else', () => {
    expect(testKycStatus('19900101123456780000')).toBe('pending_review')
    expect(testKycStatus('19900101123456781234')).toBe('approved')
    expect(testKycStatus('1990-0101-1234-5678-0000')).toBe('pending_review') // punctuation ignored
  })
})

describe('deterministic fake chain values', () => {
  it('derives a valid, stable, checksummed wallet address', () => {
    const addr = testWalletAddress('partner-1', 'user-1')
    expect(ethers.isAddress(addr)).toBe(true)
    expect(addr).toBe(ethers.getAddress(addr)) // already checksummed
    expect(testWalletAddress('partner-1', 'user-1')).toBe(addr)
    expect(testWalletAddress('partner-2', 'user-1')).not.toBe(addr)
  })

  it('derives 32-byte tx hashes and Selcom-shaped receipts', () => {
    const hash = testTxHash('deposit', 'a', 'b')
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(testReceipt('ref-1')).toMatch(/^SB[0-9A-F]{8}$/)
  })
})

describe('published cheat sheet', () => {
  it('documents every outcome the engine can produce', () => {
    const text = TEST_SCENARIOS.map((s) => `${s.trigger} ${s.result} ${s.detail}`).join(' ')
    for (const token of ['13', '02', '99', '0000', '61115582']) {
      expect(text).toContain(token)
    }
  })
})
