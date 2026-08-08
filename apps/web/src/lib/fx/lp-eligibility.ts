import { and, eq, ne } from 'drizzle-orm'

import { lpAccounts } from '@ntzs/db'

/**
 * Which LPs may be routed a fill, priced into the published rate, or counted as
 * ready.
 *
 * Every one of those queries used to ask `isActive = true` and nothing else, so
 * `status` was a label with no teeth: suspending an account changed a badge in
 * Backstage while its capital carried on filling orders. `isActive` and
 * `status` answer different questions — the first is "is this LP's capital in
 * the solver pool", the second is "is this LP allowed to trade at all" — and
 * both have to be true.
 *
 * Deliberately `ne('suspended')` rather than `eq('active')`. Requiring 'active'
 * would drop every LP still carrying an onboarding status, which today includes
 * accounts that have filled hundreds of orders; this excludes the one state
 * that means "stop", and nothing else.
 */
export function routableLp() {
  return and(eq(lpAccounts.isActive, true), ne(lpAccounts.status, 'suspended'))
}

/** The same rule, without the query builder, so it can be reasoned about and tested. */
export function isRoutable(lp: { isActive: boolean; status?: string | null }): boolean {
  return lp.isActive && lp.status !== 'suspended'
}
