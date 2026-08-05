/**
 * Partner-attested KYC — reliance on a third party for customer due diligence.
 *
 * The Selcom NIDA pair check (lib/kyc/ladder.ts) covers Tanzanians who are
 * Selcom Pesa customers, instantly and cheaply. It cannot cover everyone else:
 * a Tanzanian the registry has no record of, or anyone holding a non-Tanzanian
 * document. Those users complete identity verification in the partner's own
 * onboarding, and the partner attests the outcome to us here.
 *
 * The regulator's question about reliance is always the same: *who* verified
 * this person, *when*, against *what document*, and can you produce the file?
 * So an attestation is not a boolean — it carries the verifier, the timestamp,
 * the document type/number/country and the partner's own case reference, and
 * all of it is validated here before it can move a case. An attestation that
 * cannot answer those questions is rejected rather than recorded weakly.
 *
 * Pure by design: no database, no network, no clock of its own (the caller
 * passes `now`). The rules below are the control — they are unit-tested
 * directly, not inferred from an endpoint's behaviour.
 */

/** Document types we accept on an attestation, kept deliberately small so the
 *  identity file stays consistent. Ask compliance before extending it. */
export const ATTESTED_ID_TYPES = [
  'NATIONAL_ID',
  'PASSPORT',
  'DRIVERS_LICENSE',
  'RESIDENCE_PERMIT',
  'VOTER_ID',
] as const

export type AttestedIdType = (typeof ATTESTED_ID_TYPES)[number]

/**
 * How stale a verification may be and still issue a wallet. A year matches the
 * ordinary CDD refresh cycle; beyond it the partner re-verifies rather than
 * replaying an old decision.
 */
export const MAX_ATTESTATION_AGE_DAYS = 365

/** Tolerance for a partner's clock running ahead of ours. */
const FUTURE_SKEW_MS = 5 * 60 * 1000

export interface AttestationInput {
  decision?: unknown
  country?: unknown
  idType?: unknown
  idNumber?: unknown
  fullName?: unknown
  reference?: unknown
  verifiedBy?: unknown
  verifiedAt?: unknown
  method?: unknown
  notes?: unknown
}

export interface ParsedAttestation {
  decision: 'approved' | 'rejected'
  country: string
  /** Present on every approval; optional on a rejection (you can refuse someone with no usable document). */
  idType: AttestedIdType | null
  idNumber: string | null
  fullName: string | null
  reference: string
  verifiedBy: string
  verifiedAt: Date
  method: string | null
  notes: string | null
}

export type AttestationParse =
  | { ok: true; value: ParsedAttestation }
  | { ok: false; code: string; error: string }

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const ID_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 .\-/]{2,63}$/

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function fail(code: string, error: string): AttestationParse {
  return { ok: false, code, error }
}

/**
 * Comparison key for an identity document.
 *
 * Uppercase alphanumeric only, so "A-123 456" and "a123456" are one identity.
 * NOT digits-only: passport A1234567 and B1234567 differ by their letter, and
 * collapsing them would refuse a second, entirely unrelated person as a
 * duplicate. (For an all-digit NIDA this is identical to the digit-strip the
 * NIDA paths already use, so the two agree wherever they overlap.)
 */
export function normalizeIdentityKey(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** A real name has at least two components — "John" alone is not an identity. */
function looksLikeFullName(name: string): boolean {
  return name.split(/\s+/).filter((part) => part.length >= 2).length >= 2
}

export function parseAttestation(input: AttestationInput, now: Date = new Date()): AttestationParse {
  const rawDecision = str(input.decision) || 'approved'
  if (rawDecision !== 'approved' && rawDecision !== 'rejected') {
    return fail('invalid_decision', "decision must be 'approved' or 'rejected'.")
  }
  const decision = rawDecision

  // ── The audit anchor. Without it we cannot ask the partner for the file the
  // attestation refers to, which is the whole basis of reliance. ─────────────
  const reference = str(input.reference)
  if (reference.length < 4 || reference.length > 128) {
    return fail(
      'reference_required',
      'reference is required: your own KYC case/reference id for this verification (4–128 characters), so the underlying record can be produced on request.'
    )
  }

  const verifiedBy = str(input.verifiedBy)
  if (verifiedBy.length < 3 || verifiedBy.length > 200) {
    return fail(
      'verified_by_required',
      'verifiedBy is required: who performed the verification (reviewer email, team, or system identifier).'
    )
  }

  const verifiedAtRaw = str(input.verifiedAt)
  if (!ISO_DATE_RE.test(verifiedAtRaw)) {
    return fail('verified_at_required', 'verifiedAt is required and must be an ISO 8601 date or timestamp (e.g. 2026-08-05T09:00:00Z).')
  }
  const verifiedAt = new Date(verifiedAtRaw)
  if (Number.isNaN(verifiedAt.getTime())) {
    return fail('verified_at_required', 'verifiedAt is not a valid date.')
  }
  if (verifiedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    return fail('verified_at_future', 'verifiedAt is in the future — an identity cannot be verified before it is verified.')
  }
  const ageDays = (now.getTime() - verifiedAt.getTime()) / 86_400_000
  if (ageDays > MAX_ATTESTATION_AGE_DAYS) {
    return fail(
      'verified_at_stale',
      `verifiedAt is older than ${MAX_ATTESTATION_AGE_DAYS} days — re-verify the customer rather than replaying an expired decision.`
    )
  }

  const country = str(input.country).toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) {
    return fail('invalid_country', 'country is required and must be an ISO 3166-1 alpha-2 code (e.g. TZ, KE, GB).')
  }

  const method = str(input.method) || null
  const notes = str(input.notes) || null

  // ── A rejection needs a reason (it is what the customer is told and what the
  // file has to justify) but does not need a document — you can refuse someone
  // precisely because their document was unusable. ──────────────────────────
  if (decision === 'rejected') {
    if (!notes) {
      return fail('notes_required', 'notes is required on a rejection: the reason, in terms the customer can act on.')
    }
    const rejIdType = str(input.idType).toUpperCase()
    if (rejIdType && !(ATTESTED_ID_TYPES as readonly string[]).includes(rejIdType)) {
      return fail('invalid_id_type', `idType must be one of: ${ATTESTED_ID_TYPES.join(', ')}.`)
    }
    const rejIdNumber = str(input.idNumber)
    return {
      ok: true,
      value: {
        decision,
        country,
        idType: rejIdType ? (rejIdType as AttestedIdType) : null,
        idNumber: rejIdNumber || null,
        fullName: str(input.fullName) || null,
        reference,
        verifiedBy,
        verifiedAt,
        method,
        notes,
      },
    }
  }

  // ── An approval issues a wallet, so it must name the document it rests on ──
  const idType = str(input.idType).toUpperCase()
  if (!(ATTESTED_ID_TYPES as readonly string[]).includes(idType)) {
    return fail('invalid_id_type', `idType is required on an approval and must be one of: ${ATTESTED_ID_TYPES.join(', ')}.`)
  }

  const idNumber = str(input.idNumber)
  if (!ID_NUMBER_RE.test(idNumber)) {
    return fail('invalid_id_number', 'idNumber is required on an approval (3–64 characters, letters and digits).')
  }
  if (!normalizeIdentityKey(idNumber)) {
    return fail('invalid_id_number', 'idNumber must contain at least one letter or digit.')
  }

  const fullName = str(input.fullName)
  if (fullName.length < 3 || fullName.length > 200 || !looksLikeFullName(fullName)) {
    return fail('invalid_full_name', "fullName is required on an approval and must be the holder's full name as it appears on the document.")
  }

  return {
    ok: true,
    value: { decision, country, idType: idType as AttestedIdType, idNumber, fullName, reference, verifiedBy, verifiedAt, method, notes },
  }
}

/**
 * The one-line evidence trail stored on the case and shown in Backstage.
 *
 * "Holder:" is the prefix lib/kyc/display.ts reads to show a verified name, so
 * an attested user displays by their real name exactly like a Selcom-verified
 * one. Everything a reviewer or examiner needs is on this single line.
 */
export function formatAttestationEvidence(
  attestation: ParsedAttestation,
  partnerName: string
): string {
  const parts: string[] = []
  if (attestation.fullName) parts.push(`Holder: ${attestation.fullName}`)
  parts.push(`KYC performed by ${partnerName} under reliance agreement`)
  if (attestation.idType && attestation.idNumber) {
    parts.push(`${attestation.idType} ${attestation.idNumber} (${attestation.country})`)
  } else {
    parts.push(`Country ${attestation.country}`)
  }
  parts.push(`verified by ${attestation.verifiedBy} on ${attestation.verifiedAt.toISOString()}`)
  parts.push(`partner ref ${attestation.reference}`)
  if (attestation.method) parts.push(`method: ${attestation.method}`)
  if (attestation.notes) parts.push(`notes: ${attestation.notes}`)
  return parts.join(' · ')
}
