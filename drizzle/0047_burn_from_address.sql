-- Let a burn request specify the exact on-chain address to burn from, instead
-- of always deriving it from wallet_id. Used so merchant financing disbursements
-- burn from the LENDER's treasury wallet (deploying the lender's own capital)
-- rather than from platform float. Null = legacy behaviour (burn from wallet_id).
ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "burn_from_address" text;
