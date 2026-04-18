ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "fee_tx_hash" text;
ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "fee_recipient_address" text;
