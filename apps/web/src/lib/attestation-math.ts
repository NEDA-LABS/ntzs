/**
 * Pure math for the attestation annex — reserve composition + reconciliation
 * of the raw coverage ratio down to an adjusted 1:1 figure and a residual.
 *
 * Kept free of I/O so the accounting rules are unit-tested. All amounts are
 * TZS (1 nTZS = 1 TZS by protocol).
 *
 * Model:
 *   raw coverage        = gross reserves / totalSupply           (BoT (a)–(d))
 *   adjusted coverage   = backing reserves / effective obligations
 * where
 *   backing reserves    = gross reserves
 *                         − burned-but-unpaid payouts   (cash owed out; tokens already gone)
 *                         − fees earned but not re-minted (our income sitting in the pots)
 *                         − unmatched orphan credits    (cash with no attributed obligation)
 *   effective obligations = totalSupply
 *                         + paid-but-unminted deposits  (cash already in the pots; tokens owed)
 *   residual            = adjusted coverage − 100%
 *
 * A residual near zero means every shilling of deviation has a name. A drifting
 * residual is the real alarm — known unmodelled contributors are the PSP fee
 * spread (flat fee charged to users minus the PSP's actual cut, invisible to
 * our DB) and any opening float in the PSP accounts.
 */

export type PotSource = 'api' | 'book' | 'env'

export interface ReservePot {
  key: string
  label: string
  /** 'api' = read live from the provider; 'book' = derived from our own
   * ledger (pending settlement / not bank-verified); 'env' = declared. */
  source: PotSource
  amountTzs: number
  /** ISO timestamp of the reading. */
  asOf: string
  /** Extra context shown in the annex (e.g. "pending settlement"). */
  note?: string
}

export interface AttestationNettings {
  /** Burns executed on-chain whose cash leg has not left the pots
   * (payout pending/failed/reconcile_required), net of any fee portion
   * already re-minted to treasury for those rows. */
  burnedUnpaidTzs: number
  /** Platform/NEDA fees on completed burns that were never re-minted —
   * fee cash present in the pots with no matching supply. */
  feesUnmintedTzs: number
  /** Unmatched orphan credits — cash in the pots with no attributed deposit. */
  orphanUnmatchedTzs: number
  /** Deposits with fiat confirmed in a counted pot but tokens not yet minted. */
  paidUnmintedTzs: number
}

export interface AttestationAnnex {
  pots: ReservePot[]
  nettings: AttestationNettings
  grossReservesTzs: number
  backingReservesTzs: number
  totalSupplyTzs: number
  effectiveObligationsTzs: number
  /** (gross − supply) / supply — matches the BoT (d) figure. */
  rawDeviationPct: number
  /** backing / effective obligations, as a percentage (100 = exactly 1:1). */
  adjustedCoveragePct: number
  /** adjustedCoveragePct − 100 — the number to watch. */
  residualPct: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000

export function computeAnnex(input: {
  pots: ReservePot[]
  nettings: AttestationNettings
  totalSupplyTzs: number
}): AttestationAnnex {
  const { pots, nettings, totalSupplyTzs } = input
  const grossReservesTzs = r2(pots.reduce((s, p) => s + p.amountTzs, 0))
  const backingReservesTzs = r2(
    grossReservesTzs -
      nettings.burnedUnpaidTzs -
      nettings.feesUnmintedTzs -
      nettings.orphanUnmatchedTzs
  )
  const effectiveObligationsTzs = r2(totalSupplyTzs + nettings.paidUnmintedTzs)

  const rawDeviationPct =
    totalSupplyTzs > 0 ? r4(((grossReservesTzs - totalSupplyTzs) / totalSupplyTzs) * 100) : 0
  const adjustedCoveragePct =
    effectiveObligationsTzs > 0 ? r4((backingReservesTzs / effectiveObligationsTzs) * 100) : 100
  const residualPct = r4(adjustedCoveragePct - 100)

  return {
    pots,
    nettings,
    grossReservesTzs,
    backingReservesTzs,
    totalSupplyTzs,
    effectiveObligationsTzs,
    rawDeviationPct,
    adjustedCoveragePct,
    residualPct,
  }
}
