import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { isMissingSchemaObject } from '@/lib/db-errors'
import { partners } from '@ntzs/db'

/**
 * Is this partner relied upon for customer due diligence?
 *
 * Reliance is the authority to tell us "we verified this person" and have that
 * approve a KYC case and issue a wallet. It is granted one partner at a time,
 * by compliance, in Backstage — never by holding an API key. Every partner
 * starts without it.
 *
 * Read separately from authenticatePartner on purpose: adding these columns to
 * the auth query would make every authenticated request fail on a deployment
 * where 0076 has not been applied yet. Here a missing column simply means "not
 * granted", which is the safe answer to this question in every case.
 */
export interface KycReliance {
  enabled: boolean
  grantedAt: Date | null
  agreementRef: string | null
}

const NOT_GRANTED: KycReliance = { enabled: false, grantedAt: null, agreementRef: null }

let relianceColumnsMissing = false

export async function getKycReliance(partnerId: string): Promise<KycReliance> {
  if (relianceColumnsMissing) return NOT_GRANTED

  const { db } = getDb()
  try {
    const [row] = await db
      .select({
        enabled: partners.kycAttestationEnabled,
        grantedAt: partners.kycAttestationGrantedAt,
        agreementRef: partners.kycAttestationAgreementRef,
      })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1)
    if (!row) return NOT_GRANTED
    return { enabled: row.enabled === true, grantedAt: row.grantedAt ?? null, agreementRef: row.agreementRef ?? null }
  } catch (err) {
    if (!isMissingSchemaObject(err)) throw err
    relianceColumnsMissing = true
    console.warn('[kyc/reliance] partners.kyc_attestation_enabled not present yet — no partner is relied upon until 0076 is applied')
    return NOT_GRANTED
  }
}

/**
 * What an integrator should actually do about a user we have parked pending.
 *
 * The honest answer differs by partner, so it is computed rather than hardcoded:
 * a relied-upon partner unblocks their own user with an attestation, while
 * everyone else is waiting on our compliance team and needs to be told that
 * plainly — along with how to stop waiting on us.
 */
export function pendingIdentityNextStep(
  relianceEnabled: boolean,
  userId: string
): { nextStep: 'kyc_attestation' | 'compliance_review'; message: string } {
  if (relianceEnabled) {
    return {
      nextStep: 'kyc_attestation',
      message: `Identity verification required: verify this customer in your own onboarding, then report the outcome with POST /api/v1/users/${userId}/kyc/attestation — the wallet is issued on that call.`,
    }
  }
  return {
    nextStep: 'compliance_review',
    message:
      'Identity verification is with our compliance team (usually within one business day). If you already verify these customers yourself, ask us about a KYC reliance agreement so your own approvals activate wallets immediately.',
  }
}
