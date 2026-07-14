/**
 * PSP routing resolution — PURE functions only (no DB access here; the web
 * facade loads psp_routing rows and passes them in). Resolution order:
 *
 *   1. `rules` refinements on the row (pilot allowlist, payout amount bands)
 *   2. the row's base `provider`
 *   3. legacy env fallback (ACTIVE_MOBILE_PSP) when no row exists / on error
 *
 * Routing is consulted only at transaction CREATION. Executors and
 * reconcilers dispatch by the provider stamped on the record, so a routing
 * flip never affects in-flight money.
 */
import type { PspCapability, PspId } from './types'

export interface RoutingRow {
  provider: string
  rules?: unknown
}

export interface RoutingContext {
  /** Payout amount — enables amount-band rules on payouts_*. */
  amountTzs?: number
  /** Initiating user — enables pilot-allowlist rules on collections_*. */
  userId?: string
}

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(['snippe', 'azampay', 'selcom'])

/** Today's hardcoded behavior, used when no routing row exists (or on bad data). */
export function envDefaultProvider(capability: PspCapability): PspId {
  if (capability === 'collections_card') return 'snippe' // cards have always been Snippe
  return process.env.ACTIVE_MOBILE_PSP === 'azampay' ? 'azampay' : 'snippe'
}

interface AmountBand {
  maxAmountTzs?: number
  provider: string
}

interface PilotRules {
  pilotUserIds?: string[]
  pilotProvider?: string
}

function asPspId(candidate: string | undefined, capability: PspCapability, source: string): PspId | null {
  if (candidate && KNOWN_PROVIDERS.has(candidate)) return candidate as PspId
  if (candidate) {
    // A typo'd routing row must degrade safely, never crash a money path.
    console.error(`[psp-routing] unknown provider '${candidate}' in ${source} for ${capability} — falling back`)
  }
  return null
}

export function resolveProvider(
  capability: PspCapability,
  row: RoutingRow | null | undefined,
  ctx: RoutingContext = {},
): PspId {
  if (!row) return envDefaultProvider(capability)

  const rules = row.rules

  // Pilot allowlist: {"pilotUserIds": ["..."], "pilotProvider": "selcom"}
  if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
    const pilot = rules as PilotRules
    if (ctx.userId && Array.isArray(pilot.pilotUserIds) && pilot.pilotUserIds.includes(ctx.userId)) {
      const id = asPspId(pilot.pilotProvider, capability, 'pilot rules')
      if (id) return id
    }
  }

  // Amount bands (payouts): [{"maxAmountTzs": 150000, "provider": "azampay"}, {"provider": "selcom"}]
  // First matching band wins; an entry without maxAmountTzs is a catch-all.
  if (Array.isArray(rules)) {
    for (const entry of rules as AmountBand[]) {
      if (!entry || typeof entry !== 'object') continue
      const isCatchAll = entry.maxAmountTzs == null
      const matches = isCatchAll || (ctx.amountTzs != null && ctx.amountTzs <= entry.maxAmountTzs!)
      if (matches) {
        const id = asPspId(entry.provider, capability, 'amount bands')
        if (id) return id
      }
    }
  }

  return asPspId(row.provider, capability, 'psp_routing row') ?? envDefaultProvider(capability)
}
