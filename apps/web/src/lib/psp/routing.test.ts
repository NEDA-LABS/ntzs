import { describe, it, expect } from 'vitest'

import {
  detectNetwork,
  noCollectionRailMessage,
  planCollectionRails,
  planDisbursementRails,
  readRailEnv,
  type RailEnv,
} from './routing'

function env(overrides: Partial<RailEnv> = {}): RailEnv {
  return {
    activeMobilePsp: 'snippe',
    collectionPriority: undefined,
    perNetwork: {},
    disbursementPriority: undefined,
    snippeConfigured: true,
    azampayConfigured: true,
    azampayDisbursementEnabled: false,
    selcomConfigured: false,
    selcomCollectionsEnabled: false,
    selcomDisbursementsEnabled: false,
    ...overrides,
  }
}

describe('detectNetwork', () => {
  it('detects networks across phone formats', () => {
    expect(detectNetwork('0744277496')).toBe('vodacom')
    expect(detectNetwork('255744277496')).toBe('vodacom')
    expect(detectNetwork('+255 769 527 679')).toBe('airtel')
    expect(detectNetwork('0714641171')).toBe('tigo')
    expect(detectNetwork('0652000000')).toBe('tigo')
    expect(detectNetwork('0620000000')).toBe('halotel')
    expect(detectNetwork('0730000000')).toBe('ttcl')
  })
  it('returns unknown for short or foreign numbers', () => {
    expect(detectNetwork('12345')).toBe('unknown')
    expect(detectNetwork('')).toBe('unknown')
  })
})

describe('planCollectionRails — backwards compatibility', () => {
  it('defaults to exactly the legacy single rail when no routing env is set', () => {
    expect(planCollectionRails('vodacom', env())).toEqual(['snippe'])
    expect(planCollectionRails('tigo', env())).toEqual(['snippe'])
    expect(planCollectionRails('vodacom', env({ activeMobilePsp: 'azampay' }))).toEqual([]) // azampay can't collect M-Pesa
    expect(planCollectionRails('tigo', env({ activeMobilePsp: 'azampay' }))).toEqual(['azampay'])
  })
})

describe('planCollectionRails — multi-rail', () => {
  const multi = env({ collectionPriority: 'azampay,snippe' })

  it('orders rails by priority for supported networks', () => {
    expect(planCollectionRails('tigo', multi)).toEqual(['azampay', 'snippe'])
    expect(planCollectionRails('airtel', multi)).toEqual(['azampay', 'snippe'])
  })

  it('skips AzamPay for Vodacom M-Pesa (no collections until onboarding)', () => {
    expect(planCollectionRails('vodacom', multi)).toEqual(['snippe'])
  })

  it('per-network override wins over the global priority', () => {
    const e = env({ collectionPriority: 'azampay,snippe', perNetwork: { tigo: 'snippe' } })
    expect(planCollectionRails('tigo', e)).toEqual(['snippe'])
  })

  it('drops unconfigured rails; selcom stays out until configured AND flag-enabled', () => {
    const e = env({ collectionPriority: 'selcom,azampay,snippe', azampayConfigured: false })
    expect(planCollectionRails('tigo', e)).toEqual(['snippe'])
    // Credentials alone are not enough — the explicit flag must also be on.
    const configuredOnly = env({ collectionPriority: 'selcom,snippe', selcomConfigured: true })
    expect(planCollectionRails('tigo', configuredOnly)).toEqual(['snippe'])
  })

  it('plans selcom (incl. Vodacom M-Pesa) when configured and enabled', () => {
    const e = env({
      collectionPriority: 'selcom,snippe',
      selcomConfigured: true,
      selcomCollectionsEnabled: true,
    })
    expect(planCollectionRails('vodacom', e)).toEqual(['selcom', 'snippe'])
    expect(planCollectionRails('airtel', e)).toEqual(['selcom', 'snippe'])
  })

  it('falls back to the legacy default when a priority list filters to nothing', () => {
    const e = env({ collectionPriority: 'azampay' }) // azampay can't do vodacom
    expect(planCollectionRails('vodacom', e)).toEqual(['snippe'])
  })

  it('ignores junk entries in the priority list', () => {
    const e = env({ collectionPriority: 'mpesa,azampay, snippe ,,' })
    expect(planCollectionRails('airtel', e)).toEqual(['azampay', 'snippe'])
  })
})

describe('planDisbursementRails', () => {
  it('defaults to the legacy single rail', () => {
    expect(planDisbursementRails(env())).toEqual(['snippe'])
  })

  it('keeps AzamPay out of payouts until explicitly enabled (IP whitelisting gate)', () => {
    const e = env({ disbursementPriority: 'azampay,snippe' })
    expect(planDisbursementRails(e)).toEqual(['snippe'])
  })

  it('includes AzamPay payouts once enabled', () => {
    const e = env({ disbursementPriority: 'azampay,snippe', azampayDisbursementEnabled: true })
    expect(planDisbursementRails(e)).toEqual(['azampay', 'snippe'])
  })

  it('returns empty when nothing is configured (caller must fail closed)', () => {
    const e = env({ snippeConfigured: false, azampayConfigured: false })
    expect(planDisbursementRails(e)).toEqual([])
  })
})

/**
 * INC 6 Aug 2026 — the PSP that is our ONLY Vodacom M-Pesa collection rail
 * suspended our account. Every M-Pesa depositor hit a rail certain to refuse.
 */
describe('taking a suspended rail out of service', () => {
  const base: RailEnv = {
    activeMobilePsp: 'snippe',
    collectionPriority: undefined,
    perNetwork: {},
    disbursementPriority: 'selcom,snippe',
    snippeConfigured: true,
    azampayConfigured: true,
    azampayDisbursementEnabled: false,
    selcomConfigured: true,
    selcomCollectionsEnabled: false,
    selcomDisbursementsEnabled: true,
  }

  it('SNIPPE_ENABLED=false removes the rail without deleting the key', () => {
    // The credentials stay — we want the account back — but routing a customer
    // to a rail that will certainly refuse only produces a support ticket.
    const live = readRailEnv({ SNIPPE_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)
    const suspended = readRailEnv({ SNIPPE_API_KEY: 'k', SNIPPE_ENABLED: 'false' } as unknown as NodeJS.ProcessEnv)
    expect(live.snippeConfigured).toBe(true)
    expect(suspended.snippeConfigured).toBe(false)
  })

  it('leaves Vodacom with no collection rail, rather than a doomed one', () => {
    // AzamPay cannot collect Vodacom; Selcom collections are off. Returning an
    // empty plan is the honest answer — the caller then shows a real message
    // instead of the customer watching a push that never arrives.
    const suspended = { ...base, snippeConfigured: false }
    expect(planCollectionRails('vodacom', suspended)).toEqual([])
  })

  it('TRAP: with the legacy single-rail config, disabling it stops EVERY network', () => {
    // Not a bug — a configuration requirement made visible. The plan is
    // "exactly ACTIVE_MOBILE_PSP", so removing that rail leaves nothing, even
    // for networks another rail could serve. Silently substituting a rail the
    // operator never declared would move customer money somewhere unintended.
    const suspended = { ...base, snippeConfigured: false }
    for (const n of ['airtel', 'tigo', 'halotel'] as const) {
      expect(planCollectionRails(n, suspended)).toEqual([])
    }
  })

  it('and the remedy is config: declare the priority list BEFORE disabling a rail', () => {
    const suspended = { ...base, snippeConfigured: false, collectionPriority: 'azampay,snippe' }
    for (const n of ['airtel', 'tigo', 'halotel'] as const) {
      expect(planCollectionRails(n, suspended), `${n} must still collect`).toEqual(['azampay'])
    }
    // Vodacom still cannot be served — AzamPay does not collect M-Pesa — which
    // is exactly the case the customer message exists for.
    expect(planCollectionRails('vodacom', suspended)).toEqual([])
  })

  it('keeps payouts running on Selcom', () => {
    // Losing collections must not also stop customers getting money out.
    const suspended = { ...base, snippeConfigured: false }
    expect(planDisbursementRails(suspended)).toEqual(['selcom'])
  })
})

describe('what the customer is told', () => {
  it('names their wallet, not our provider', () => {
    const msg = noCollectionRailMessage('vodacom')
    expect(msg).toContain('M-Pesa')
    // A customer can act on neither the provider's name nor its troubles.
    expect(msg.toLowerCase()).not.toContain('snippe')
    expect(msg.toLowerCase()).not.toContain('suspend')
  })

  it('says it is temporary and calms the real fear', () => {
    const msg = noCollectionRailMessage('vodacom')
    expect(msg).toContain('temporarily')
    // The thing people actually panic about.
    expect(msg).toContain('balance is unaffected')
    expect(msg).toContain('nothing has been charged')
  })

  it('only ever suggests alternatives that are actually switched on', () => {
    // A pointer at a disabled feature is worse than none — this message once
    // said "deposit by bank transfer" while that flag was off.
    const none = noCollectionRailMessage('vodacom')
    expect(none).not.toContain('bank transfer')
    expect(none).not.toContain('Lipa Namba')
    expect(none).toContain('another mobile network')

    const lipa = noCollectionRailMessage('vodacom', { lipaNamba: true })
    expect(lipa).toContain('Lipa Namba')
    expect(lipa).not.toContain('bank transfer')

    const both = noCollectionRailMessage('vodacom', { lipaNamba: true, bankTransfer: true })
    expect(both).toContain('Lipa Namba')
    expect(both).toContain('bank transfer')
  })

  it('tells a stranded M-Pesa user the one path that works without a push rail', () => {
    // Lipa Namba is customer-initiated — they pay our till from their own
    // menu — so it survives the loss of every push rail. The message must say
    // that plainly enough for someone mid-deposit to act on it.
    const msg = noCollectionRailMessage('vodacom', { lipaNamba: true })
    expect(msg).toContain('pay from your own phone')
  })

  it('has a name for every network', () => {
    for (const n of ['vodacom', 'airtel', 'tigo', 'halotel', 'ttcl', 'unknown'] as const) {
      expect(noCollectionRailMessage(n).length).toBeGreaterThan(40)
    }
  })
})
