/**
 * @ntzs/psp — shared PSP layer for web + worker.
 *
 * - types.ts    canonical request/response interfaces + PspId/capability types
 * - registry.ts PspAdapter interface + ADAPTERS (dispatch surface)
 * - routing.ts  pure capability→provider resolution (rules/bands/pilots)
 * - fees.ts     per-provider fee model (client-safe, dependency-free)
 * - balances.ts multi-pot reserve balances (reserve = Σ pots)
 *
 * Provider modules are also exported as namespaces for webhook handlers,
 * which are provider-specific by design (payload shapes + signatures).
 */
export * from './types'
export * from './registry'
export * from './routing'
export * from './fees'
export * from './balances'

export * as snippe from './snippe'
export * as azampay from './azampay'
export * as selcom from './selcom'
export * as zenopay from './zenopay'
