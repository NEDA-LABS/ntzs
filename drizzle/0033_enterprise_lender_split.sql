-- Extend merchant_accounts with lender repayment fields
ALTER TABLE "merchant_accounts"
  ADD COLUMN "lender_partner_id" uuid REFERENCES "partners"("id") ON DELETE SET NULL,
  ADD COLUMN "lender_split_pct" integer NOT NULL DEFAULT 0,
  ADD COLUMN "lender_pending_tzs" bigint NOT NULL DEFAULT 0;

-- Extend merchant_collections with lender snapshot fields
-- Reuses merchant_settlement_status enum (pending|queued|processing|completed|failed|skipped)
ALTER TABLE "merchant_collections"
  ADD COLUMN "lender_pct" integer NOT NULL DEFAULT 0,
  ADD COLUMN "lender_amount_tzs" bigint,
  ADD COLUMN "lender_settlement_status" "merchant_settlement_status" NOT NULL DEFAULT 'skipped';

-- Enterprise account types
CREATE TYPE "enterprise_account_type" AS ENUM ('capital_lender', 'disbursement_client');
CREATE TYPE "enterprise_loan_status" AS ENUM ('active', 'repaid', 'terminated');

-- Enterprise accounts (thin identity layer on top of partners)
CREATE TABLE "enterprise_accounts" (
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
CREATE UNIQUE INDEX "enterprise_accounts_email_uq" ON "enterprise_accounts"("email");
CREATE INDEX "enterprise_accounts_partner_id_idx" ON "enterprise_accounts"("partner_id");

-- OTP codes for enterprise login
CREATE TABLE "enterprise_otp_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" varchar(320) NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "enterprise_otp_codes_email_idx" ON "enterprise_otp_codes"("email");
CREATE INDEX "enterprise_otp_codes_expires_at_idx" ON "enterprise_otp_codes"("expires_at");

-- Invite tokens (magic link sent after ops approval)
CREATE TABLE "enterprise_invite_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enterprise_id" uuid NOT NULL REFERENCES "enterprise_accounts"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "enterprise_invite_tokens_token_hash_uq" ON "enterprise_invite_tokens"("token_hash");
CREATE INDEX "enterprise_invite_tokens_enterprise_id_idx" ON "enterprise_invite_tokens"("enterprise_id");

-- Loan agreements (Ramani → merchant working capital)
CREATE TABLE "enterprise_loan_agreements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "partners"("id") ON DELETE RESTRICT,
  "merchant_id" uuid NOT NULL REFERENCES "merchant_accounts"("id") ON DELETE RESTRICT,
  "principal_tzs" bigint NOT NULL,
  "repaid_tzs" bigint NOT NULL DEFAULT 0,
  "status" "enterprise_loan_status" NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "enterprise_loan_agreements_partner_id_idx" ON "enterprise_loan_agreements"("partner_id");
CREATE INDEX "enterprise_loan_agreements_merchant_id_idx" ON "enterprise_loan_agreements"("merchant_id");
CREATE INDEX "enterprise_loan_agreements_status_idx" ON "enterprise_loan_agreements"("status");
