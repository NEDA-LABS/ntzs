-- 0066: developer TEST MODE — a fully simulated nTZS API.
--
-- ⚠ "Test mode" here is the DEVELOPER sandbox (Stripe-style test keys), NOT the
-- Bank of Tanzania regulatory sandbox (that is lib/sandbox/limits.ts). The two
-- are unrelated; the naming is deliberately different everywhere.
--
-- Isolation is STRUCTURAL, not conditional: test-mode activity is written to
-- its own tables and never to users / wallets / deposit_requests /
-- burn_requests / mints. Attestation, on-chain supply, reserve pots and every
-- Backstage aggregate therefore cannot see test money — there is no filter to
-- forget, because there is no row to filter.
--
-- partners.mode          'live' (default — every existing partner) | 'test'
-- partners.live_partner_id  on a test partner, the live partner it belongs to
--
-- Safe to apply at any time: the columns are defaulted and the tables are new.

ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "mode" text NOT NULL DEFAULT 'live';
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "live_partner_id" uuid;

CREATE INDEX IF NOT EXISTS "partners_live_partner_id_idx" ON "partners" ("live_partner_id");

CREATE TABLE IF NOT EXISTS "test_mode_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
  "external_id" text NOT NULL,
  "email" text,
  "name" text,
  "phone" text,
  "wallet_address" text NOT NULL,
  "balance_tzs" bigint NOT NULL DEFAULT 0,
  "kyc_status" text NOT NULL DEFAULT 'approved',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "test_mode_users_partner_external_uq"
  ON "test_mode_users" ("partner_id", "external_id");

CREATE TABLE IF NOT EXISTS "test_mode_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "test_mode_users"("id") ON DELETE CASCADE,
  -- 'deposit' | 'withdrawal' | 'spend' | 'transfer'
  "kind" text NOT NULL,
  -- 'pending' | 'completed' | 'failed' | 'reconcile_required'
  "status" text NOT NULL,
  "amount_tzs" bigint NOT NULL DEFAULT 0,
  -- Signed effect on the user's simulated balance, applied at settlement.
  "balance_delta_tzs" bigint NOT NULL DEFAULT 0,
  "fees" jsonb,
  "detail" jsonb,
  -- When a pending transaction becomes terminal. Settlement is swept on the
  -- next API call (no cron): serverless-safe and deterministic.
  "settles_at" timestamptz,
  "settled_at" timestamptz,
  "webhook_sent" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "test_mode_transactions_partner_created_idx"
  ON "test_mode_transactions" ("partner_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "test_mode_transactions_due_idx"
  ON "test_mode_transactions" ("status", "settles_at");
