/**
 * NEDA Labs protocol fee — what the RAIL OPERATOR earns on every burn-based
 * transaction (spend, withdrawal), on top of the partner's own margin and
 * separate from Selcom/PSP cost. Minted to the platform (NEDA) treasury.
 *
 * Model: add-on. nedaFee = max(principal × bps, floor). The bps gives a share
 * of every ticket; the floor guarantees a non-zero earn on tiny tickets and
 * even when a partner zeroes their own fee. Coverage-neutral: the extra nTZS
 * burned from the user is re-minted 1:1 to the NEDA treasury.
 *
 * Both knobs are env-overridable so the rate can be tuned (or the fee switched
 * off with bps=0 + floor=0) without a code deploy. Defaults 30 bps + 30 TZS.
 */

export const NEDA_PROTOCOL_FEE_BPS_DEFAULT = 30
export const NEDA_PROTOCOL_FEE_FLOOR_TZS_DEFAULT = 30

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export function nedaProtocolFeeBps(): number {
  return envInt('NEDA_PROTOCOL_FEE_BPS', NEDA_PROTOCOL_FEE_BPS_DEFAULT)
}

export function nedaProtocolFeeFloorTzs(): number {
  return envInt('NEDA_PROTOCOL_FEE_FLOOR_TZS', NEDA_PROTOCOL_FEE_FLOOR_TZS_DEFAULT)
}

/** The NEDA protocol fee (TZS) on a transaction of `principalTzs`. Returns 0
 * for a non-positive principal, or when both knobs are 0 (fee disabled). */
export function nedaProtocolFeeTzs(principalTzs: number): number {
  if (!Number.isFinite(principalTzs) || principalTzs <= 0) return 0
  const bps = nedaProtocolFeeBps()
  const floor = nedaProtocolFeeFloorTzs()
  if (bps === 0 && floor === 0) return 0
  return Math.max(Math.round((principalTzs * bps) / 10000), floor)
}
