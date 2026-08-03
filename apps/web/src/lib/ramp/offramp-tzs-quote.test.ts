import { describe, it, expect } from 'vitest'

import { solveOfframpGrossTzs, usdcForGrossTzs, rampPlatformFeeTzs } from './quote'
import { estimateSendMoneyFee, estimateBillPayFee } from '@/lib/psp/selcom-fees'
import { calcMinOutput } from '@/lib/fx/swap'

/**
 * StablePay (3 Aug 2026): "our users request payouts in local currency, not
 * USDC — they must get exactly what they specified." Off-ramp quotes therefore
 * accept a target NET tzsAmount and answer with the USDC to debit. The fee
 * chain is a step function (tiered PSP fee + ceil'd platform pct), so the
 * inverse must GUARANTEE the recipient's exact net — these pin that guarantee.
 */

const PLATFORM_PCT = 0.5

describe('solveOfframpGrossTzs', () => {
  const selcomFees = (g: number) => rampPlatformFeeTzs(g, PLATFORM_PCT) + estimateSendMoneyFee(Math.floor(g))
  const net = (g: number, fees: (x: number) => number) => g - fees(g)

  it('every target 5,000–8,000 TZS solves feasibly and minimally across Selcom tier edges', () => {
    // The 4,999→6,999 (60→150) and 6,999→9,999 (150→160) tier boundaries both
    // sit inside this sweep — where naive division would short the recipient.
    for (let target = 5000; target <= 8000; target++) {
      const g = solveOfframpGrossTzs(target, selcomFees)
      expect(g, `no gross found for ${target}`).not.toBeNull()
      expect(net(g!, selcomFees), `gross ${g} under-nets target ${target}`).toBeGreaterThanOrEqual(target)
      expect(net(g! - 1, selcomFees), `gross ${g} not minimal for ${target}`).toBeLessThan(target)
      // The recipient gets EXACTLY the target; any unreachable-net sliver is
      // bounded by one fee-tier jump and stays in feeTzs.
      expect(net(g!, selcomFees) - target).toBeLessThanOrEqual(200)
    }
  })

  it('flat-fee shapes (legacy 1,500 rail) reach every target exactly', () => {
    const flatFees = (g: number) => rampPlatformFeeTzs(g, PLATFORM_PCT) + 1500
    for (const target of [5000, 6837, 25_000, 149_990]) {
      const g = solveOfframpGrossTzs(target, flatFees)
      expect(g).not.toBeNull()
      // Flat PSP fee → net only stalls (never jumps), so exactness holds.
      expect(net(g!, flatFees)).toBe(target)
    }
  })

  it('free-tier biller destinations solve with zero PSP fee', () => {
    const govFees = (g: number) => rampPlatformFeeTzs(g, PLATFORM_PCT) + estimateBillPayFee('GEPG', Math.floor(g))
    const g = solveOfframpGrossTzs(10_000, govFees)
    expect(g).not.toBeNull()
    expect(net(g!, govFees)).toBe(10_000)
  })

  it('never loops forever on a pathological fee shape', () => {
    // A fee that always eats more than the gross can never net anything.
    expect(solveOfframpGrossTzs(5000, (g) => g + 1)).toBeNull()
  })
})

describe('usdcForGrossTzs', () => {
  it('the debited USDC always swap-yields at least the gross (never shorts the settlement)', () => {
    const midRate = 2650
    for (const gross of [5210, 6999, 7031, 152_000, 1_000_003]) {
      for (const [bidBps, askBps] of [[50, 50], [30, 80], [0, 0]] as const) {
        const u = usdcForGrossTzs(gross, midRate, bidBps, askBps)
        const out = calcMinOutput({ fromToken: 'USDC', toToken: 'NTZS', amount: u, midRate, bidBps, askBps, slippageBps: 0 })
        expect(Math.floor(out), `gross ${gross} @ ask ${askBps}`).toBeGreaterThanOrEqual(gross)
        // Rounding up at 6 dp costs at most ~a hundredth of a shilling.
        expect(out - gross).toBeLessThan(0.01)
      }
    }
  })
})
