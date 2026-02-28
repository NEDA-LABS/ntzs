ALTER TABLE "partners"
  ADD COLUMN IF NOT EXISTS "treasury_wallet_address" text,
  ADD COLUMN IF NOT EXISTS "fee_percent" numeric(5, 2) NOT NULL DEFAULT 0;
