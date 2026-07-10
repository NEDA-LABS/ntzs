/**
 * Tier-1 identity binding: prove the person entering a NIDA number controls a
 * mobile-money line that a telco biometrically registered to that same person.
 *
 * SIM registration in Tanzania requires NIDA + fingerprints, so the registered
 * name (or ID number) behind an MSISDN is strong, regulator-legible evidence —
 * obtained through the PSP name-lookup we already integrate, no new vendors.
 *
 * Policy (enforce when evidence exists, record when it doesn't):
 *  - lookup returns the registered ID number:
 *      equals the NIDA        → 'verified_id'   (strongest binding)
 *      differs                → 'mismatch'      (HARD FAIL — someone else's SIM)
 *  - lookup returns a name:   ≥2 components agree with the NIDA holder
 *                             → 'verified_name', else 'mismatch' (HARD FAIL)
 *  - lookup can't answer (PSP without lookup — e.g. Snippe active — API down,
 *    or no mobile-money account): → 'unverified' (proceed; evidence recorded so
 *    enforcement activates automatically wherever the lookup works)
 */
import { lookupRecipientName, normalizePhone } from '@/lib/psp'
import { matchNames, sameIdNumber } from './name-match'

export type BindingOutcome =
  | { outcome: 'verified_id'; phone: string; evidence: string }
  | { outcome: 'verified_name'; phone: string; matchedTokens: number; evidence: string }
  | { outcome: 'mismatch'; phone: string; evidence: string }
  | { outcome: 'unverified'; phone: string; evidence: string }

export async function bindPhoneToNidaIdentity(opts: {
  phone: string
  nidaNumber: string
  nidaFullName: string | null
}): Promise<BindingOutcome> {
  const phone = normalizePhone(opts.phone)

  let lookup: { name: string | null; idNumber?: string }
  try {
    lookup = await lookupRecipientName(phone)
  } catch {
    lookup = { name: null }
  }

  if (lookup.idNumber) {
    if (sameIdNumber(lookup.idNumber, opts.nidaNumber)) {
      return { outcome: 'verified_id', phone, evidence: 'MSISDN registered ID matches NIDA (telco-biometric binding)' }
    }
    return { outcome: 'mismatch', phone, evidence: 'MSISDN is registered to a different ID number' }
  }

  if (lookup.name) {
    const match = matchNames(opts.nidaFullName, lookup.name)
    if (match.matched) {
      return {
        outcome: 'verified_name',
        phone,
        matchedTokens: match.matchedTokens,
        evidence: `MSISDN registered name matches NIDA holder (${match.matchedTokens} components, telco-biometric binding)`,
      }
    }
    if (match.comparable) {
      return { outcome: 'mismatch', phone, evidence: `MSISDN registered name does not match NIDA holder (${match.matchedTokens} components)` }
    }
  }

  return { outcome: 'unverified', phone, evidence: 'MSISDN binding unavailable (no lookup evidence) — NIDA-only verification' }
}
