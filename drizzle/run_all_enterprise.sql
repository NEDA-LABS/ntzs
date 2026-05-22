-- ============================================================
-- Enterprise tier — run this once in Neon SQL editor
-- Combines migrations 0033, 0034, 0035
-- ============================================================

-- ── 0033: lender split fields ────────────────────────────────

ALTER TABLE "merchant_accounts"
  ADD COLUMN IF NOT EXISTS "lender_partner_id" uuid REFERENCES "partners"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "lender_split_pct" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lender_pending_tzs" bigint NOT NULL DEFAULT 0;

ALTER TABLE "merchant_collections"
  ADD COLUMN IF NOT EXISTS "lender_pct" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lender_amount_tzs" bigint,
  ADD COLUMN IF NOT EXISTS "lender_settlement_status" "merchant_settlement_status" NOT NULL DEFAULT 'skipped';

DO $$ BEGIN
  CREATE TYPE "enterprise_account_type" AS ENUM ('capital_lender', 'disbursement_client');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "enterprise_loan_status" AS ENUM ('active', 'repaid', 'terminated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "enterprise_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "email" varchar(320) NOT NULL,
  "phone" varchar(32),
  "type" "enterprise_account_type" NOT NULL,
  "partner_id" uuid REFERENCES "partners"("id") ON DELETE SET NULL,
  "password_hash" text,
  "is_active" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_accounts_email_uq" ON "enterprise_accounts"("email");
CREATE INDEX IF NOT EXISTS "enterprise_accounts_partner_id_idx" ON "enterprise_accounts"("partner_id");

CREATE TABLE IF NOT EXISTS "enterprise_otp_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" varchar(320) NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "enterprise_otp_codes_email_idx" ON "enterprise_otp_codes"("email");
CREATE INDEX IF NOT EXISTS "enterprise_otp_codes_expires_at_idx" ON "enterprise_otp_codes"("expires_at");

CREATE TABLE IF NOT EXISTS "enterprise_invite_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enterprise_id" uuid NOT NULL REFERENCES "enterprise_accounts"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_invite_tokens_token_hash_uq" ON "enterprise_invite_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "enterprise_invite_tokens_enterprise_id_idx" ON "enterprise_invite_tokens"("enterprise_id");

CREATE TABLE IF NOT EXISTS "enterprise_loan_agreements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "partners"("id") ON DELETE RESTRICT,
  "merchant_id" uuid NOT NULL REFERENCES "merchant_accounts"("id") ON DELETE RESTRICT,
  "principal_tzs" bigint NOT NULL,
  "repaid_tzs" bigint NOT NULL DEFAULT 0,
  "status" "enterprise_loan_status" NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "enterprise_loan_agreements_partner_id_idx" ON "enterprise_loan_agreements"("partner_id");
CREATE INDEX IF NOT EXISTS "enterprise_loan_agreements_merchant_id_idx" ON "enterprise_loan_agreements"("merchant_id");
CREATE INDEX IF NOT EXISTS "enterprise_loan_agreements_status_idx" ON "enterprise_loan_agreements"("status");

-- ── 0034: disbursement tables ────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "enterprise_disbursement_batch_status" AS ENUM (
    'pending_review', 'awaiting_funds', 'approved', 'processing', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "enterprise_disbursement_row_status" AS ENUM (
    'pending', 'processing', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "enterprise_disbursement_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enterprise_id" uuid NOT NULL REFERENCES "enterprise_accounts"("id") ON DELETE RESTRICT,
  "partner_id" uuid NOT NULL REFERENCES "partners"("id") ON DELETE RESTRICT,
  "filename" text,
  "total_amount_tzs" bigint NOT NULL,
  "service_fee_tzs" bigint NOT NULL,
  "contractor_count" integer NOT NULL,
  "status" "enterprise_disbursement_batch_status" NOT NULL DEFAULT 'pending_review',
  "bank_reference" text,
  "bank_received_at" timestamptz,
  "processed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "enterprise_disbursement_batches_enterprise_id_idx" ON "enterprise_disbursement_batches"("enterprise_id");
CREATE INDEX IF NOT EXISTS "enterprise_disbursement_batches_status_idx" ON "enterprise_disbursement_batches"("status");
CREATE INDEX IF NOT EXISTS "enterprise_disbursement_batches_created_at_idx" ON "enterprise_disbursement_batches"("created_at");

CREATE TABLE IF NOT EXISTS "enterprise_disbursement_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" uuid NOT NULL REFERENCES "enterprise_disbursement_batches"("id") ON DELETE CASCADE,
  "contractor_name" text NOT NULL,
  "phone" varchar(32) NOT NULL,
  "amount_tzs" bigint NOT NULL,
  "payout_method" text NOT NULL DEFAULT 'mobile',
  "bank_account" text,
  "status" "enterprise_disbursement_row_status" NOT NULL DEFAULT 'pending',
  "payout_reference" text,
  "payout_error" text,
  "burn_request_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "enterprise_disbursement_rows_batch_id_idx" ON "enterprise_disbursement_rows"("batch_id");
CREATE INDEX IF NOT EXISTS "enterprise_disbursement_rows_status_idx" ON "enterprise_disbursement_rows"("status");

-- ── 0035: merchant financing (settlement lock, interest, marketplace) ──

ALTER TABLE merchant_accounts
  ADD COLUMN IF NOT EXISTS lender_controls_settlement boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS withdrawal_limit_tzs bigint NOT NULL DEFAULT 0;

ALTER TABLE enterprise_loan_agreements
  ADD COLUMN IF NOT EXISTS interest_rate_pct integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interest_tzs bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_owed_tzs bigint NOT NULL DEFAULT 0;

UPDATE enterprise_loan_agreements SET total_owed_tzs = principal_tzs WHERE total_owed_tzs = 0;

CREATE TABLE IF NOT EXISTS enterprise_merchant_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprise_accounts(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  direction text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  proposed_split_pct integer,
  message text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS enterprise_merchant_applications_pending_uq
  ON enterprise_merchant_applications (enterprise_id, merchant_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS enterprise_merchant_applications_enterprise_id_idx ON enterprise_merchant_applications (enterprise_id);
CREATE INDEX IF NOT EXISTS enterprise_merchant_applications_merchant_id_idx ON enterprise_merchant_applications (merchant_id);
CREATE INDEX IF NOT EXISTS enterprise_merchant_applications_status_idx ON enterprise_merchant_applications (status);
