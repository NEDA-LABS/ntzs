import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

const SRC = path.join(__dirname, '../..')

/**
 * On 1 Aug 2026 Snippe flagged our merchant account and refused every payout
 * initiation. Every interactive cash-out died in reconcile_required — because
 * those paths dispatched on a SINGLE rail (plain sendPayout), while the
 * failover engine built for exactly this day served only the batch burn
 * engine, and Selcom sat configured and untried.
 *
 * These pins keep every user-facing payout on the routed dispatcher, with the
 * serving rail persisted (webhooks and status queries are provider-scoped).
 */
describe('interactive cash-outs ride the failover engine', () => {
  const PATHS = [
    'app/api/v1/withdrawals/route.ts',
    'app/app/user/withdraw/actions.ts',
    'lib/ramp/offramp.ts',
    'app/api/v1/partners/treasury/withdraw/route.ts',
    'app/api/admin/burns/[id]/reconcile/route.ts',
  ]

  it('every payout call site uses sendPayoutRouted, none the single-rail sendPayout', () => {
    for (const rel of PATHS) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(src, `${rel} must dispatch with failover`).toContain('sendPayoutRouted(')
      // 'sendPayout(' would also match the Routed call — pin the exact
      // single-rail invocation shape instead.
      expect(src, `${rel} must not dispatch single-rail`).not.toMatch(/await sendPayout\(/)
    }
  })

  it('the serving rail is persisted and polled, not assumed', () => {
    for (const rel of ['app/api/v1/withdrawals/route.ts', 'lib/ramp/offramp.ts']) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(src, `${rel} must persist the serving rail`).toContain('payoutProvider')
      expect(src, `${rel} must poll the rail that dispatched`).toContain('checkPayoutStatusFor(')
      expect(src, `${rel} must not poll the single active PSP`).not.toMatch(/await checkPayoutStatus\(/)
    }
  })

  it('an all-rails refusal records which rails were tried', () => {
    for (const rel of ['app/api/v1/withdrawals/route.ts', 'app/app/user/withdraw/actions.ts', 'lib/ramp/offramp.ts', 'app/api/admin/burns/[id]/reconcile/route.ts']) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(src, `${rel} must evidence the attempted rails`).toContain('rails tried')
    }
  })

  it('withdrawals refuse an accidental identical retry (the double-burn of 1 Aug)', () => {
    const src = fs.readFileSync(path.join(SRC, 'app/api/v1/withdrawals/route.ts'), 'utf8')
    // A user whose payout stalled retried and burned twice for one intended
    // cash-out — the "do not retry" message asked, nothing enforced it.
    expect(src).toContain('duplicate_withdrawal')
    expect(src).toContain('allowDuplicate')
  })
})

/**
 * Follow-up from the same day: the first live withdrawal after the rails were
 * restored was QUOTED Snippe's flat 1,500 PSP fee while Selcom (tier fee 150)
 * served it — the user overpaid 1,350. Pricing must follow the rail that will
 * serve, the charged fee must be persisted, and dispatch must back out the
 * row's OWN fee (not a constant) or recipients get the wrong amount.
 */
describe('quotes price the rail that will serve', () => {
  it('every withdrawal pricing site resolves the PSP fee from the disbursement plan', () => {
    for (const rel of [
      'app/api/v1/withdrawals/quote/route.ts',
      'app/api/v1/withdrawals/route.ts',
      'app/app/user/withdraw/actions.ts',
      'lib/merchant/withdraw.ts',
      'lib/ramp/quote.ts',
      'lib/testmode/handlers.ts',
    ]) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(src, `${rel} must price the PSP fee on the expected rail`).toContain('expectedPayoutFeeTzs(')
    }
  })

  it('the charged PSP fee is persisted per row and backed out at dispatch', () => {
    const engine = fs.readFileSync(path.join(SRC, 'lib/payouts/burn-engine.ts'), 'utf8')
    expect(engine, 'burn engine must read the row fee').toContain('psp_fee_tzs')
    expect(engine, 'burn engine must net with the row fee').toContain('pspFeeTzs: job.psp_fee_tzs')
    const reconcile = fs.readFileSync(path.join(SRC, 'app/api/admin/burns/[id]/reconcile/route.ts'), 'utf8')
    expect(reconcile, 'redispatch must back out the row fee, flat as legacy fallback').toContain('burn.pspFeeTzs ?? PSP_FLAT_FEE_TZS')
    for (const rel of ['app/api/v1/withdrawals/route.ts', 'app/app/user/withdraw/actions.ts', 'lib/merchant/withdraw.ts']) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(src, `${rel} must persist the charged PSP fee on the burn row`).toMatch(/psp_fee_tzs|pspFeeTzs,/)
    }
  })

  it('completion surfaces carry the user-facing payout confirmation (rail, reference, message)', () => {
    for (const rel of ['app/api/v1/withdrawals/route.ts', 'app/api/v1/withdrawals/[id]/route.ts']) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(src, `${rel} must return a confirmationMessage`).toContain('confirmationMessage')
      expect(src, `${rel} must expose the serving rail`).toContain('payoutRail')
    }
  })
})
