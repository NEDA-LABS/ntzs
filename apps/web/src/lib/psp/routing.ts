/**
 * Multi-rail PSP routing — pure planning logic (no I/O, unit-tested).
 *
 * Collections and disbursements are planned independently, per mobile
 * network, across every configured rail. One PSP being down (or simply not
 * supporting a network — e.g. AzamPay has no Vodacom M-Pesa collections yet)
 * must never strand a user: initiation fails over to the next rail in the
 * plan, and the burn engine refuses to burn when no disbursement rail is
 * healthy.
 *
 * Rails:
 *   snippe  — live (collections incl. M-Pesa, disbursements)
 *   azampay — collections (Yas/Airtel/Halo/AzamPesa; M-Pesa pending Vodacom
 *             onboarding); disbursements gated behind
 *             AZAMPAY_DISBURSEMENT_ENABLED until IP whitelisting is resolved
 *   selcom  — registered, disabled: adapter pending their Push USSD API
 *             (see docs/selcom-integration-spec.md §4)
 *
 * BACKWARDS COMPATIBLE BY DEFAULT: with none of the routing env vars set,
 * every plan is exactly [ACTIVE_MOBILE_PSP] — identical to the single-rail
 * behaviour that shipped before this module.
 */

export type RailId = 'snippe' | 'azampay' | 'selcom'

export type Network = 'vodacom' | 'airtel' | 'tigo' | 'halotel' | 'ttcl' | 'unknown'

/** Tanzanian mobile network from any common phone format (last 9 digits). */
export function detectNetwork(phone: string): Network {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 9) return 'unknown'
  const nine = digits.slice(-9)
  const p2 = nine.slice(0, 2)
  if (p2 === '76') {
    // The 076x range is split: 0760–0767 Vodacom, 0768–0769 Airtel.
    return nine[2] >= '8' ? 'airtel' : 'vodacom'
  }
  if (['74', '75'].includes(p2)) return 'vodacom'
  if (['68', '69', '78'].includes(p2)) return 'airtel'
  if (['71', '65', '67', '77'].includes(p2)) return 'tigo'
  if (['61', '62'].includes(p2)) return 'halotel'
  if (['73'].includes(p2)) return 'ttcl'
  return 'unknown'
}

export interface RailEnv {
  /** ACTIVE_MOBILE_PSP — the legacy single-rail switch and final fallback. */
  activeMobilePsp: string | undefined
  /** COLLECTION_RAIL_PRIORITY — e.g. "azampay,snippe". */
  collectionPriority: string | undefined
  /** COLLECTION_RAILS_<NETWORK> — per-network override, e.g. vodacom: "snippe". */
  perNetwork: Partial<Record<Network, string | undefined>>
  /** DISBURSEMENT_RAIL_PRIORITY — e.g. "snippe,azampay". */
  disbursementPriority: string | undefined
  snippeConfigured: boolean
  azampayConfigured: boolean
  /** AzamPay payouts stay off until IP whitelisting is resolved. */
  azampayDisbursementEnabled: boolean
}

const ALL_RAILS: RailId[] = ['snippe', 'azampay', 'selcom']

function parseRailList(raw: string | undefined): RailId[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is RailId => (ALL_RAILS as string[]).includes(s))
}

function defaultRail(env: RailEnv): RailId {
  return env.activeMobilePsp === 'azampay' ? 'azampay' : 'snippe'
}

function collectionCapable(rail: RailId, network: Network, env: RailEnv): boolean {
  switch (rail) {
    case 'snippe':
      return env.snippeConfigured
    case 'azampay':
      // No Vodacom M-Pesa collections until AzamPay's Vodacom onboarding
      // completes — routing a M-Pesa user there would hard-fail every time.
      return env.azampayConfigured && network !== 'vodacom'
    case 'selcom':
      return false // adapter pending (Push USSD API awaited)
  }
}

function disbursementCapable(rail: RailId, env: RailEnv): boolean {
  switch (rail) {
    case 'snippe':
      return env.snippeConfigured
    case 'azampay':
      return env.azampayConfigured && env.azampayDisbursementEnabled
    case 'selcom':
      return false // adapter pending
  }
}

/** Ordered rails to attempt for a collection from the given network. */
export function planCollectionRails(network: Network, env: RailEnv): RailId[] {
  const configured =
    parseRailList(env.perNetwork[network]) // per-network override wins
  const base = configured.length
    ? configured
    : parseRailList(env.collectionPriority)
  const plan = (base.length ? base : [defaultRail(env)]).filter((r) =>
    collectionCapable(r, network, env)
  )
  // Never return an empty plan while the legacy default is usable — a
  // misconfigured priority list must not take deposits down.
  if (plan.length === 0 && collectionCapable(defaultRail(env), network, env)) {
    return [defaultRail(env)]
  }
  return [...new Set(plan)]
}

/** Ordered rails to attempt for a mobile-money disbursement. */
export function planDisbursementRails(env: RailEnv): RailId[] {
  const base = parseRailList(env.disbursementPriority)
  const plan = (base.length ? base : [defaultRail(env)]).filter((r) => disbursementCapable(r, env))
  if (plan.length === 0 && disbursementCapable(defaultRail(env), env)) {
    return [defaultRail(env)]
  }
  return [...new Set(plan)]
}

/** Build RailEnv from process.env (the only impure step, kept trivial). */
export function readRailEnv(env: NodeJS.ProcessEnv = process.env): RailEnv {
  return {
    activeMobilePsp: env.ACTIVE_MOBILE_PSP,
    collectionPriority: env.COLLECTION_RAIL_PRIORITY,
    perNetwork: {
      vodacom: env.COLLECTION_RAILS_VODACOM,
      airtel: env.COLLECTION_RAILS_AIRTEL,
      tigo: env.COLLECTION_RAILS_TIGO,
      halotel: env.COLLECTION_RAILS_HALOTEL,
      ttcl: env.COLLECTION_RAILS_TTCL,
      unknown: env.COLLECTION_RAIL_PRIORITY,
    },
    disbursementPriority: env.DISBURSEMENT_RAIL_PRIORITY,
    snippeConfigured: Boolean(env.SNIPPE_API_KEY),
    azampayConfigured: Boolean(env.AZAMPAY_APP_NAME && env.AZAMPAY_CLIENT_ID && env.AZAMPAY_CLIENT_SECRET),
    azampayDisbursementEnabled: env.AZAMPAY_DISBURSEMENT_ENABLED === 'true',
  }
}
