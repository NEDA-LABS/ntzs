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
 *   selcom  — adapter ported (push-USSD collections, disbursements, balance,
 *             statement); BOTH sides gated behind explicit env flags
 *             (SELCOM_COLLECTIONS_ENABLED / SELCOM_DISBURSEMENTS_ENABLED)
 *             until Selcom's pre-live details + rotated credentials land.
 *             Note: Selcom also IP-whitelists (error 611) — production needs
 *             the static-egress relay, same as AzamPay disbursements.
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
  if (['74', '75', '79'].includes(p2)) return 'vodacom'
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
  selcomConfigured: boolean
  /** Selcom sides are individually flag-gated until pre-live sign-off. */
  selcomCollectionsEnabled: boolean
  selcomDisbursementsEnabled: boolean
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
      // Push-USSD covers every network incl. M-Pesa; explicit flag until
      // Selcom's pre-live sign-off + rotated credentials.
      return env.selcomConfigured && env.selcomCollectionsEnabled
  }
}

function disbursementCapable(rail: RailId, env: RailEnv): boolean {
  switch (rail) {
    case 'snippe':
      return env.snippeConfigured
    case 'azampay':
      return env.azampayConfigured && env.azampayDisbursementEnabled
    case 'selcom':
      return env.selcomConfigured && env.selcomDisbursementsEnabled
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
  //
  // ⚠ OPERATIONAL TRAP, learned 6 Aug 2026. This rescues a bad priority list,
  // NOT a dead default rail. With the legacy single-rail config
  // (ACTIVE_MOBILE_PSP set, no COLLECTION_RAIL_PRIORITY), disabling that one
  // rail empties the plan for EVERY network — including ones another rail could
  // serve perfectly well. That is deliberate: routing a customer's money
  // through a rail the operator never declared is not a decision this function
  // gets to make silently. The remedy is configuration — set
  // COLLECTION_RAIL_PRIORITY (or a per-network override) BEFORE disabling a
  // rail — and the emptied plan is what makes the omission loud instead of
  // quietly moving money somewhere unintended.
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

/** How a Tanzanian would name the wallet behind a number. */
const NETWORK_WALLET_NAMES: Record<Network, string> = {
  vodacom: 'M-Pesa (Vodacom)',
  airtel: 'Airtel Money',
  tigo: 'Mixx by Yas (Tigo)',
  halotel: 'HaloPesa',
  ttcl: 'T-Pesa',
  unknown: 'this mobile network',
}

/**
 * What to tell a customer when no rail can push a payment prompt to their
 * network.
 *
 * This is not an error string for a log — it is what somebody sees when they
 * are trying to put money in and cannot. So it says which network, that the
 * cause is ours and temporary, what they can do instead, and — the part people
 * actually worry about — that money already in their wallet is untouched.
 *
 * The alternatives are passed in by the caller from what is ACTUALLY enabled,
 * because a suggestion that leads to a disabled feature is worse than none:
 * this message once pointed at bank transfer while that flag was off. The
 * Lipa Namba option matters most — it is customer-initiated (they pay our
 * till from their own M-Pesa menu), so it works even when no push rail covers
 * their network at all.
 *
 * Deliberately does not name the provider or the reason: a customer cannot act
 * on either, and a provider's commercial troubles are not their business.
 */
export function noCollectionRailMessage(
  network: Network,
  available: { lipaNamba?: boolean; bankTransfer?: boolean } = {}
): string {
  const wallet = NETWORK_WALLET_NAMES[network] ?? NETWORK_WALLET_NAMES.unknown
  const alternatives: string[] = []
  if (available.lipaNamba) {
    alternatives.push("use the 'Lipa Namba' deposit option (you pay from your own phone — it works on every network)")
  }
  if (available.bankTransfer) {
    alternatives.push('deposit by bank transfer')
  }
  alternatives.push('try another mobile network')
  const advice =
    alternatives.length === 1
      ? `Please ${alternatives[0]}.`
      : `Please ${alternatives.slice(0, -1).join(', ')}, or ${alternatives[alternatives.length - 1]}.`
  return `${wallet} deposits are temporarily unavailable while we restore service with our payment provider. ${advice} Your nTZS balance is unaffected and nothing has been charged.`
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
    // SNIPPE_ENABLED=false takes the rail out of every plan without deleting
    // the key. Needed when a provider suspends the account: the credentials are
    // still ours and we want them back, but routing a customer to a rail that
    // is certain to refuse only produces a failed payment and a support ticket.
    snippeConfigured: Boolean(env.SNIPPE_API_KEY) && env.SNIPPE_ENABLED !== 'false',
    azampayConfigured: Boolean(env.AZAMPAY_APP_NAME && env.AZAMPAY_CLIENT_ID && env.AZAMPAY_CLIENT_SECRET),
    azampayDisbursementEnabled: env.AZAMPAY_DISBURSEMENT_ENABLED === 'true',
    selcomConfigured: Boolean(env.SELCOM_API_KEY && env.SELCOM_PRIVATE_KEY && env.SELCOM_ACCOUNT_NUMBER),
    selcomCollectionsEnabled: env.SELCOM_COLLECTIONS_ENABLED === 'true',
    selcomDisbursementsEnabled: env.SELCOM_DISBURSEMENTS_ENABLED === 'true',
  }
}
