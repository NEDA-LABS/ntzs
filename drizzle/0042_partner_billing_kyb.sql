-- Add WaaS billing columns to partners
ALTER TABLE "partners"
  ADD COLUMN IF NOT EXISTS "joining_fee_usd"  numeric(12, 2) NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS "joining_fee_paid_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "pilot_ends_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "wallet_allocation" integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "contract_end_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "monthly_fee_usd" numeric(12, 2) NOT NULL DEFAULT 2000;

-- Partner invoice type + status enums
DO $$ BEGIN
  CREATE TYPE "partner_invoice_type" AS ENUM ('joining_fee', 'saas_monthly', 'transaction_fees');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "partner_invoice_status" AS ENUM ('pending', 'paid', 'void', 'overdue');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Partner invoices
CREATE TABLE IF NOT EXISTS "partner_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_id" uuid NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
  "type" "partner_invoice_type" NOT NULL,
  "amount_usd" numeric(12, 2) NOT NULL,
  "status" "partner_invoice_status" NOT NULL DEFAULT 'pending',
  "period_start" timestamptz,
  "period_end" timestamptz,
  "due_at" timestamptz,
  "paid_at" timestamptz,
  "payment_method" text,
  "payment_ref" text,
  "late_interest_usd" numeric(12, 2) NOT NULL DEFAULT 0,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "partner_invoices_partner_id_idx" ON "partner_invoices" ("partner_id");
CREATE INDEX IF NOT EXISTS "partner_invoices_status_idx" ON "partner_invoices" ("status");
CREATE INDEX IF NOT EXISTS "partner_invoices_due_at_idx" ON "partner_invoices" ("due_at");

-- Partner KYB status enum
DO $$ BEGIN
  CREATE TYPE "partner_kyb_status" AS ENUM ('not_started', 'submitted', 'under_review', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Partner KYB records (one per partner)
CREATE TABLE IF NOT EXISTS "partner_kyb" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_id" uuid NOT NULL UNIQUE REFERENCES "partners"("id") ON DELETE CASCADE,
  "status" "partner_kyb_status" NOT NULL DEFAULT 'not_started',
  "business_legal_name" text,
  "registration_number" text,
  "registered_address" text,
  "authorized_rep_name" text,
  "authorized_rep_title" text,
  "authorized_rep_email" text,
  "license_type" text,
  "license_number" text,
  "issuing_authority" text,
  "jurisdiction" text,
  "cert_of_incorporation_url" text,
  "regulatory_license_url" text,
  "aml_policy_url" text,
  "review_notes" text,
  "reviewed_at" timestamptz,
  "reviewed_by" text,
  "submitted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "partner_kyb_status_idx" ON "partner_kyb" ("status");
