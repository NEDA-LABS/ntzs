/**
 * Pure display helpers for KYC review/oversight surfaces.
 *
 * The verified NIDA-holder name is embedded in kyc_cases.review_reason by the
 * verification ladder ("NIDA holder: ASHA JUMA MRISHO · …"), so review UIs can
 * show real verified names without a schema change. Kept pure for unit tests.
 */

/**
 * Extract the verified holder name from a ladder/attestation evidence string.
 *
 * Two prefixes because two sources: "NIDA holder:" from the Selcom registry,
 * "Holder:" from a partner attestation (whose document is often not a NIDA).
 * Case matters — "NIDA holder:" must not be read as a bare "Holder:".
 */
export function extractNidaHolderName(reviewReason: string | null | undefined): string | null {
  if (!reviewReason) return null
  const match = /(?:NIDA holder|Holder):\s*([^·]+)/.exec(reviewReason)
  const name = match?.[1]?.trim()
  return name ? name : null
}

/**
 * Best display name for a KYC row: verified holder name (strongest), then the
 * user's declared name, then the email's local part.
 */
export function kycDisplayName(opts: {
  reviewReason: string | null | undefined
  declaredName: string | null | undefined
  email: string | null | undefined
}): string {
  const verified = extractNidaHolderName(opts.reviewReason)
  if (verified) return verified
  const declared = (opts.declaredName ?? '').trim()
  if (declared) return declared
  const email = opts.email ?? ''
  return email.includes('@') ? email.slice(0, email.indexOf('@')) : email || 'Unknown'
}
