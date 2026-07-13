/**
 * Risk-tiered identity verification ladder (BoT Parameter 8) — the provider
 * seam that keeps any single KYC vendor from being able to stop onboarding.
 *
 *   Tier A — Selcom Identity pair check (instant, bank-grade CDD, but covers
 *            only Selcom Pesa customers).
 *   Tier B — telco SIM-registration evidence via the PSP name/ID lookup
 *            (any network; SIM registration = NIDA + fingerprints by law).
 *   Tier C — human maker-checker review (kyc_cases status 'pending' →
 *            Backstage → KYC), so nobody dead-ends.
 *
 * Decision matrix (fail-closed; ambiguity never approves):
 *   Selcom verified            → approved (Tier B attached as extra evidence,
 *                                unless it contradicts — then rejected)
 *   Selcom pair mismatch       → rejected (phone belongs to someone else)
 *   Selcom no record           → Tier B: registered-ID match → review (STRONG,
 *                                fast-track); registered-ID/name contradiction
 *                                → rejected; silent → review
 *   Selcom unavailable         → unavailable (retry later; never a verdict)
 *
 * Dependencies are injected so the matrix is unit-tested without network. New
 * providers (Selcom registry tier, NIDA-direct via eGA) slot in as steps here
 * without touching call sites.
 */
import type { BindingOutcome } from './binding'
import type { SelcomVerification } from './selcom'

export interface IdentityLadderInput {
  /** Normalized 20-digit NIDA. */
  nidaNumber: string
  /** User's mobile-money number (any common TZ format). */
  phone: string
}

export interface IdentityLadderDeps {
  verifyPair: (nidaNumber: string, phone: string) => Promise<SelcomVerification>
  bindPhone: (opts: { phone: string; nidaNumber: string; nidaFullName: string | null }) => Promise<BindingOutcome>
}

export type IdentityLadderVerdict =
  | { outcome: 'approved'; provider: 'selcom_nida'; fullName: string | null; reference: string | null; evidence: string }
  | { outcome: 'rejected'; code: 'identity_binding_failed' | 'kyc_failed'; evidence: string; userMessage: string }
  | { outcome: 'review'; evidence: string; userMessage: string }
  | { outcome: 'unavailable'; error: string; userMessage: string }

const REVIEW_MESSAGE =
  'We could not verify your identity automatically, so it has been submitted for manual review. You will be able to continue once our team confirms it — usually within one business day.'

const MISMATCH_MESSAGE =
  'This mobile number is not registered to the holder of this NIDA number. Use the mobile money number registered in your own name.'

export async function runIdentityLadder(
  deps: IdentityLadderDeps,
  input: IdentityLadderInput
): Promise<IdentityLadderVerdict> {
  const selcom = await deps.verifyPair(input.nidaNumber, input.phone)

  if (selcom.status === 'unavailable') {
    return {
      outcome: 'unavailable',
      error: selcom.error,
      userMessage: 'Identity verification is temporarily unavailable. Please try again shortly.',
    }
  }

  if (selcom.status === 'mismatch') {
    return {
      outcome: 'rejected',
      code: 'identity_binding_failed',
      evidence: `Selcom pair check failed: ${selcom.message ?? 'mobile number does not match NIDA'}`,
      userMessage: MISMATCH_MESSAGE,
    }
  }

  if (selcom.status === 'verified') {
    // Tier B runs as supplementary evidence; a contradiction outranks.
    const binding = await deps.bindPhone({
      phone: input.phone,
      nidaNumber: input.nidaNumber,
      nidaFullName: selcom.fullName,
    })
    if (binding.outcome === 'mismatch') {
      return {
        outcome: 'rejected',
        code: 'identity_binding_failed',
        evidence: `Selcom pair verified but telco registration contradicts: ${binding.evidence}`,
        userMessage: MISMATCH_MESSAGE,
      }
    }
    return {
      outcome: 'approved',
      provider: 'selcom_nida',
      fullName: selcom.fullName,
      reference: selcom.reference,
      evidence: `${selcom.fullName ? `NIDA holder: ${selcom.fullName}` : 'NIDA verified via Selcom Identity'} · Selcom NIDA+MSISDN pair verified · ${binding.evidence}`,
    }
  }

  // Selcom has no record — typically a genuine person who is not a Selcom
  // Pesa customer (coverage, not fraud). Tier B decides between hard fail and
  // human review; nothing auto-approves without an authoritative record.
  const binding = await deps.bindPhone({
    phone: input.phone,
    nidaNumber: input.nidaNumber,
    nidaFullName: null,
  })

  if (binding.outcome === 'mismatch') {
    return {
      outcome: 'rejected',
      code: 'identity_binding_failed',
      evidence: `Selcom: no record · ${binding.evidence}`,
      userMessage: MISMATCH_MESSAGE,
    }
  }

  const strength = binding.outcome === 'verified_id' ? 'STRONG (fast-track): ' : ''
  return {
    outcome: 'review',
    evidence: `Selcom: no record (likely not a Selcom Pesa customer) · ${strength}${binding.evidence}`,
    userMessage: REVIEW_MESSAGE,
  }
}
