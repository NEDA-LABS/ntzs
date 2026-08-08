/**
 * How long a withdrawal has been waiting on us, and how loudly to say so.
 *
 * Three participant withdrawals sat in `requires_second_approval` from late
 * June to early August — over six weeks — and nobody noticed, because the queue
 * was ordered newest-first and they had long since fallen off the bottom of the
 * page. They were found only when a regulatory return reported their amounts as
 * transactions that had occurred.
 *
 * A queue ordered by arrival is a log. A queue ordered by what is waiting is a
 * work list. This module is the difference: it decides what counts as waiting
 * on us, how old that is, and how prominently it should appear.
 */

/**
 * Statuses where the customer is waiting and the next move is ours.
 *
 * `burned`, `rejected` and `failed` are terminal — nothing is owed. Everything
 * else means a person asked for their money and has not got it: `requested` and
 * `requires_second_approval` await a human decision, `approved` awaits
 * execution, and `burn_submitted` awaits a chain confirmation that should take
 * seconds and therefore says something is wrong if it ages at all.
 */
export const HELD_BURN_STATUSES = ['requested', 'requires_second_approval', 'approved', 'burn_submitted'] as const

export type HeldBurnStatus = (typeof HELD_BURN_STATUSES)[number]

export function isHeld(status: string): boolean {
  return (HELD_BURN_STATUSES as readonly string[]).includes(status)
}

/**
 * Escalation bands, in hours. A withdrawal within a working day is ordinary
 * operations; past three days the customer has almost certainly asked twice;
 * past a week it is a service failure whatever the reason for the hold.
 */
const AGEING_HOURS = 24
const STALE_HOURS = 72
const OVERDUE_HOURS = 168

export type AgeingTier = 'fresh' | 'ageing' | 'stale' | 'overdue'

export interface BurnAgeing {
  tier: AgeingTier
  hours: number
  /** Short human label — "4h", "3d", "44d". */
  label: string
  /** True once this is worth interrupting someone about. */
  needsAttention: boolean
}

/**
 * Age a held request. `now` is a parameter so the banding is testable and so a
 * server render and its assertions cannot disagree about the clock.
 */
export function burnAgeing(createdAt: Date | string, now: Date): BurnAgeing {
  const created = new Date(createdAt).getTime()
  const hours = Math.max(0, (now.getTime() - created) / 3_600_000)

  const tier: AgeingTier =
    hours >= OVERDUE_HOURS ? 'overdue' : hours >= STALE_HOURS ? 'stale' : hours >= AGEING_HOURS ? 'ageing' : 'fresh'

  const label = hours < 1 ? '<1h' : hours < 48 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`

  return { tier, hours, label, needsAttention: tier === 'stale' || tier === 'overdue' }
}

export interface AgeableBurn {
  status: string
  createdAt: Date | string
}

/**
 * Order a burn queue as a work list: everything waiting on us first, oldest at
 * the top, then the settled history newest-first.
 *
 * The oldest-first part is the whole point. Newest-first inside the held group
 * would reproduce the original failure — the request that has waited longest is
 * the one furthest from the top.
 */
export function orderBurnQueue<T extends AgeableBurn>(rows: T[]): T[] {
  const held = rows.filter((r) => isHeld(r.status))
  const settled = rows.filter((r) => !isHeld(r.status))
  const at = (r: T) => new Date(r.createdAt).getTime()
  return [...held.sort((a, b) => at(a) - at(b)), ...settled.sort((a, b) => at(b) - at(a))]
}

export interface QueueSummary {
  held: number
  needsAttention: number
  /** Age of the longest-waiting held request, or null when nothing is held. */
  oldest: BurnAgeing | null
  /** Total shillings a participant has asked for and not received. */
  heldTzs: number
}

export function summariseBurnQueue<T extends AgeableBurn & { amountTzs: number | string }>(
  rows: T[],
  now: Date
): QueueSummary {
  const held = rows.filter((r) => isHeld(r.status))
  const aged = held.map((r) => burnAgeing(r.createdAt, now))
  // Sorting a copy: mutating the caller's array to compute a summary is the
  // kind of surprise that shows up as a mis-ordered table three files away.
  const oldest = aged.length ? [...aged].sort((a, b) => b.hours - a.hours)[0] : null

  return {
    held: held.length,
    needsAttention: aged.filter((a) => a.needsAttention).length,
    oldest,
    heldTzs: held.reduce((sum, r) => sum + Number(r.amountTzs ?? 0), 0),
  }
}
