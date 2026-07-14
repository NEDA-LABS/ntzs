/**
 * Multi-pot reserve balances. The nTZS reserve is POOLED across every PSP
 * account (fungibility principle): reserve = Σ pots. Consumers (oversight
 * page, BoT attestation) must sum all pots and surface per-pot errors —
 * a pot that fails to fetch is FLAGGED, never silently zeroed, because an
 * under-reported reserve is a regulatory incident, not a fallback.
 */
import { ADAPTERS, PSP_IDS } from './registry'
import type { PspId } from './types'

export interface ReservePot {
  provider: PspId
  label: string
  available: number
  pending: number
  currency: string
  /** Set when the balance fetch failed — the pot is unknown, NOT zero. */
  error?: string
}

/**
 * Fetch the balance of every credential-configured PSP in parallel.
 * Never throws: per-pot failures are captured on the pot itself.
 */
export async function getReserveBalances(): Promise<ReservePot[]> {
  const configured = PSP_IDS.filter((id) => ADAPTERS[id].isConfigured())
  return Promise.all(
    configured.map(async (id): Promise<ReservePot> => {
      const adapter = ADAPTERS[id]
      try {
        const b = await adapter.getBalance()
        return { provider: id, label: adapter.label, available: b.available, pending: b.pending, currency: b.currency }
      } catch (err) {
        return {
          provider: id,
          label: adapter.label,
          available: 0,
          pending: 0,
          currency: 'TZS',
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )
}
