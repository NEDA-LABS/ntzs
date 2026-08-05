import { NextResponse } from 'next/server'

/**
 * RETIRED — `POST /api/v1/users/:id/kyc/session` (document-capture sessions).
 *
 * We ran document verification through a third-party capture vendor. It was
 * priced per attempt, and attempts are exactly what a retry-friendly onboarding
 * flow produces, so the cost scaled with the users we could least afford to
 * charge for. Identity verification for these users now happens where it was
 * already happening — in the partner's own onboarding — and reaches us as an
 * attested outcome instead.
 *
 * Replacement: `POST /api/v1/users/:id/kyc/attestation`, which approves the
 * case AND issues the wallet in one call.
 *
 * Kept as an explicit 410 rather than deleted: an integrator who still calls
 * this deserves to be told what happened and where to go, not a bare 404 that
 * looks like an outage.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Document-capture sessions have been retired. Verify these users in your own onboarding and report the outcome with POST /api/v1/users/:id/kyc/attestation (requires a reliance agreement — contact compliance).',
      code: 'endpoint_retired',
      replacedBy: 'POST /api/v1/users/:id/kyc/attestation',
    },
    { status: 410 }
  )
}
