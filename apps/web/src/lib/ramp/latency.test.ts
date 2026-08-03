import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

const offramp = () => fs.readFileSync(path.join(__dirname, 'offramp.ts'), 'utf8')
const swap = () => fs.readFileSync(path.join(__dirname, '../fx/swap.ts'), 'utf8')

/**
 * 3 Aug 2026, StablePay: "transactions taking 40–50 seconds… we target 30
 * seconds maximum." The budget was gas top-up + two swap waits + burn wait +
 * TWO awaited fee-mint waits + up to 21s of awaited PSP polling, all at
 * ethers' 4s polling default. These pin the fast path — and the one wait
 * that must never be optimized away.
 */
describe('off-ramp latency posture', () => {
  it('the burn confirmation wait is NON-NEGOTIABLE — value captured before fiat dispatch', () => {
    const src = offramp()
    // The burn tx must be awaited to 1 confirmation before any payout leg.
    expect(src).toContain('await tx.wait(1)')
    const burnWait = src.indexOf('await tx.wait(1)')
    const spendDispatch = src.indexOf('dispatchSpendPayment(')
    const walletDispatch = src.indexOf('sendPayoutRouted(')
    expect(burnWait).toBeGreaterThan(-1)
    expect(spendDispatch).toBeGreaterThan(burnWait)
    expect(walletDispatch).toBeGreaterThan(burnWait)
  })

  it('fee mints broadcast without blocking the payout leg', () => {
    const src = offramp()
    // Best-effort bookkeeping mints: hash recorded, no awaited confirmation
    // (the app withdrawal set this precedent). Nonce ordering still serializes
    // any revert burn-back behind them on-chain.
    expect(src).not.toMatch(/feeTx\.wait\(/)
    expect(src).not.toMatch(/nedaTx\.wait\(/)
  })

  it('PSP polling is bounded — the webhook is the finisher, not the connection', () => {
    const src = offramp()
    expect(src).toContain('pollDeadlineMs')
    // The wallet-leg inline poll must not regress to the 21s ladder.
    expect(src).not.toContain('[3000, 6000, 12000]')
  })

  it('providers poll at chain speed, not the 4s ethers default', () => {
    expect(offramp()).toContain('pollingInterval = 1000')
    expect(swap()).toContain('pollingInterval = 1000')
  })

  it('pre-swap balance reads share one round trip', () => {
    expect(offramp()).toContain('Promise.all([')
  })
})
