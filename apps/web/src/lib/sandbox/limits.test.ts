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
  rampCounterpartyRef,
  parseRampCounterpartyRef,
  rampPhoneVariants,
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

  /**
   * Routes that legitimately check a cap with no sandbox participant to count
   * against. Currently none — and the bar for adding one is high.
   *
   * merchant/pay was listed here on the reasoning that "the payer pays from
   * their own mobile money, so there is no nTZS participant." That was wrong:
   * the payer is not the participant, the MERCHANT is — the collection mints
   * nTZS into the merchant's wallet. An exemption is a claim about who holds
   * the token, so check where the tokens land before writing one.
   */
  const EXEMPT: Record<string, string> = {}

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

  it('merchant collections count against the merchant, not the payer', () => {
    const src = fs.readFileSync(path.join(APP, 'merchant/pay/route.ts'), 'utf8')
    const at = src.indexOf('enforceSandboxLimits(')
    expect(at, 'merchant/pay must enforce the participant caps').toBeGreaterThan(-1)
    // The subject has to be the merchant's participant record. The payer funds
    // the collection from their own mobile money and never holds nTZS; the
    // merchant is who the minted balance lands on.
    expect(src.slice(at, at + 160)).toContain('mUser.id')
  })

  /**
   * The scanner above only catches a route that calls a RAW checker without
   * the chokepoint. A route that never references the caps at all slips
   * through silently — which is exactly how the ramp path went live with no
   * BoT cap on it, found the day RAMP_SPEND_ENABLED went on. Every money
   * route therefore also gets a POSITIVE assertion naming its subject.
   */
  it('the ramp routes enforce the caps per Tanzanian-side counterparty', () => {
    for (const rel of ['v1/ramp/quote/route.ts', 'v1/ramp/offramp/route.ts', 'v1/ramp/onramp/route.ts']) {
      const src = fs.readFileSync(path.join(APP, rel), 'utf8')
      expect(src.indexOf('enforceSandboxLimits('), `${rel} must enforce the BoT caps`).toBeGreaterThan(-1)
      // Parameters #4/#5 cap what one WALLET does in a period. The subject is
      // therefore the till / bill account / phone wallet the settlement
      // touches — never the partner or its whole float, which would turn a
      // per-wallet parameter into a platform throughput cap (the first
      // shipped version's mistake: 200 merchants paid 50,000 each would have
      // been refused after the 40th, as if one user had spent it all).
      expect(src, `${rel} must count per counterparty`).toContain('rampCounterpartySubject(')
      expect(src, `${rel} must not aggregate the float as one participant`).not.toContain('ramp_float')
    }
  })

  /**
   * The scanner above walks `app/api/**\/route.ts` only. Every money path that
   * is NOT an API route was therefore invisible to it — server actions, and
   * library helpers that write the tables directly.
   *
   * That blind spot is not hypothetical. The user portal's own deposit and
   * withdrawal actions create participant deposit and burn rows and reference
   * no cap at all; nothing failed, because nothing was looking. The first real
   * periodic return then read the platform's own float movements as customer
   * transactions and told the Bank a participant had transacted TZS 1,509,046
   * against an approved cap of 1,000,000.
   *
   * So the inventory is explicit. Every writer of deposit_requests or
   * burn_requests is listed with what it is; adding a writer without listing it
   * fails this test, and listing one as exempt requires saying who holds the
   * tokens.
   */
  describe('every writer of a participant deposit or burn is accounted for', () => {
    const SRC = path.join(__dirname, '../..')

    /**
     * Writers that move the platform's or a partner's own working capital.
     * The per-participant parameters do not describe these — no customer holds
     * the balance at either end — and the return reports them separately as
     * platform float. An entry here is a claim about who holds the tokens.
     */
    const PLATFORM_FLOAT: Record<string, string> = {
      'app/api/v1/partners/fund-treasury/route.ts': "a partner topping up its own float; the row is booked to the partner's treasury service account",
      'app/simplefx/api/lp/mint/route.ts': 'a liquidity provider funding its own account on the exchange side',
      'lib/fx/bank-cashout.ts': 'the liquidity-provider cash-out leg, against the same LP account',
      'lib/ramp/onramp.ts': 'the settlement leg of a ramp; the route above it enforces per counterparty before anything is written',
      'lib/ramp/offramp.ts': 'the settlement leg of a ramp; the route above it enforces per counterparty before anything is written',
    }

    function walkAll(dir: string, base = ''): string[] {
      const out: string[] = []
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        const rel = base ? `${base}/${e.name}` : e.name
        if (e.isDirectory()) out.push(...walkAll(path.join(dir, e.name), rel))
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(rel)
      }
      return out
    }

    const writers = walkAll(SRC).filter((rel) => {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      return src.includes('insert(depositRequests)') || src.includes('insert(burnRequests)')
    })

    it('finds the writers at all, so a silent rename cannot empty this test', () => {
      expect(writers.length).toBeGreaterThan(5)
    })

    it('every participant-facing writer enforces the caps', () => {
      const offenders = writers.filter((rel) => {
        if (rel in PLATFORM_FLOAT) return false
        return !fs.readFileSync(path.join(SRC, rel), 'utf8').includes('enforceSandboxLimits(')
      })
      expect(
        offenders,
        'These create a participant deposit or burn with no BoT cap. Call enforceSandboxLimits(), or ' +
          'add the file to PLATFORM_FLOAT with the reason no participant holds the balance:\n  ' +
          offenders.join('\n  ')
      ).toEqual([])
    })

    it('keeps the platform-float list honest — no stale entries', () => {
      const stale = Object.keys(PLATFORM_FLOAT).filter((rel) => !writers.includes(rel))
      expect(stale, `no longer writes deposits or burns; remove from PLATFORM_FLOAT:\n  ${stale.join('\n  ')}`).toEqual([])
    })
  })

  it('a ramp counterparty keeps one identity across formats and round-trips', () => {
    // The subject id doubles as the evidence key (subject_ref), so the ref
    // must survive a round-trip — including bill refs, which follow a second
    // ':' — and every spelling of one MSISDN must resolve to one wallet.
    for (const cp of [
      { kind: 'lipa', payNumber: '115045768' },
      { kind: 'bill', utilityCode: 'LUKU', utilityRef: '24219217817' },
      { kind: 'phone', phone: '0744277496' },
    ] as const) {
      expect(parseRampCounterpartyRef(rampCounterpartyRef(cp))).toEqual(cp)
    }
    expect(new Set(rampPhoneVariants('0744277496'))).toEqual(
      new Set(['0744277496', '+255744277496', '255744277496'])
    )
    expect(new Set(rampPhoneVariants('+255 744 277 496'))).toEqual(
      new Set(['+255744277496', '255744277496', '0744277496'])
    )
  })

  it('ramp enforcement and ramp usage accounting agree on the gross TZS leg', () => {
    // An off-ramp row stores the recipient NET in tzs_amount with the fee
    // split out; an on-ramp row's tzs_amount is already gross. If a route
    // enforces on one convention and the checker sums the other, a partner
    // gets silently more (or less) headroom than the Bank approved.
    const offramp = fs.readFileSync(path.join(APP, 'v1/ramp/offramp/route.ts'), 'utf8')
    expect(offramp).toContain('quote.tzsAmount + quote.feeTzs')
    const onrampAt = fs.readFileSync(path.join(APP, 'v1/ramp/onramp/route.ts'), 'utf8').indexOf('enforceSandboxLimits(')
    expect(fs.readFileSync(path.join(APP, 'v1/ramp/onramp/route.ts'), 'utf8').slice(onrampAt, onrampAt + 220)).not.toContain('feeTzs')
    const checker = fs.readFileSync(path.join(__dirname, 'limits.ts'), 'utf8')
    expect(checker).toContain("case when ${rampSettlements.direction} = 'offramp' then ${rampSettlements.feeTzs} else 0 end")
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
