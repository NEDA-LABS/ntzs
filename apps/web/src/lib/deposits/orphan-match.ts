/**
 * Pure matching rules for attaching orphan PSP payments (money that reached
 * the PSP with no deposit_request_id — e.g. a direct till payment) to
 * 'submitted' deposit requests. Kept free of I/O so the rules are unit-tested.
 */

export interface OrphanLike {
  amountTzs: number
  payerPhone: string | null
}

export interface SubmittedDepositLike {
  id: string
  amountTzs: number
  buyerPhone: string | null
}

/**
 * Tanzanian MSISDNs compare equal on their last 9 digits, so 0748288520,
 * 255748288520 and +255 748 288 520 are all the same line.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? '').replace(/\D/g, '')
  const db = (b ?? '').replace(/\D/g, '')
  if (da.length < 9 || db.length < 9) return false
  return da.slice(-9) === db.slice(-9)
}

export interface OrphanMatchSuggestion<T> {
  /**
   * The sole amount+phone match — safe to offer as the highlighted one-click
   * attach. null when zero or several deposits share the amount AND payer
   * phone (e.g. the same user submitted twice): the admin must pick.
   */
  exact: T | null
  /** Every submitted deposit with the same amount, phone-matched first. */
  candidates: T[]
}

export function suggestOrphanMatch<T extends SubmittedDepositLike>(
  orphan: OrphanLike,
  submitted: T[]
): OrphanMatchSuggestion<T> {
  const sameAmount = submitted.filter((d) => d.amountTzs === orphan.amountTzs)
  const phoneMatched = orphan.payerPhone
    ? sameAmount.filter((d) => samePhone(d.buyerPhone, orphan.payerPhone))
    : []
  const rest = sameAmount.filter((d) => !phoneMatched.includes(d))
  return {
    exact: phoneMatched.length === 1 ? phoneMatched[0] : null,
    candidates: [...phoneMatched, ...rest],
  }
}

/** True when this candidate's phone matches the orphan's payer phone. */
export function isPhoneMatch(orphan: OrphanLike, deposit: SubmittedDepositLike): boolean {
  return Boolean(orphan.payerPhone) && samePhone(deposit.buyerPhone, orphan.payerPhone)
}
