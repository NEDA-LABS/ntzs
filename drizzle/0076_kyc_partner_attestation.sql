-- Partner-attested KYC (reliance on a third party for CDD).
--
-- Replaces the SmileID document-verification rail for users the Selcom NIDA
-- ladder cannot cover — non-Selcom customers and identities outside Tanzania.
-- Those users complete KYC in the partner's own onboarding (NEDApay), and the
-- partner attests the outcome to us over the API. The attestation approves the
-- kyc_case and issues the wallet in one call, so a user is never approved twice
-- to get one wallet.
--
-- FAIL-CLOSED: reliance is OFF for every partner until compliance grants it
-- explicitly in Backstage. An API key alone can never approve an identity —
-- if this column is false the attestation endpoint returns 403, so a leaked
-- key cannot manufacture verified identities.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS kyc_attestation_enabled boolean NOT NULL DEFAULT false;

-- When reliance was granted, and the signed reliance agreement it rests on.
-- BoT can ask "which partners perform CDD on your behalf, since when, under
-- what agreement" and that must be answerable from one row.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS kyc_attestation_granted_at timestamptz;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS kyc_attestation_agreement_ref text;
