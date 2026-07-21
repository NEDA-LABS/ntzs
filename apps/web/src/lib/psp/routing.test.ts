import { describe, it, expect } from 'vitest'

import { detectNetwork, planCollectionRails, planDisbursementRails, type RailEnv } from './routing'

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
