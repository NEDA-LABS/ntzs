-- Disbursement batch and row status enums
CREATE TYPE "enterprise_disbursement_batch_status" AS ENUM (
  'pending_review', 'awaiting_funds', 'approved', 'processing', 'completed', 'failed'
);
CREATE TYPE "enterprise_disbursement_row_status" AS ENUM (
  'pending', 'processing', 'completed', 'failed'
);

-- Disbursement batches (Advent CSV upload → single bank transfer)
CREATE TABLE "enterprise_disbursement_batches" (
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
CREATE INDEX "enterprise_disbursement_batches_enterprise_id_idx" ON "enterprise_disbursement_batches"("enterprise_id");
CREATE INDEX "enterprise_disbursement_batches_status_idx" ON "enterprise_disbursement_batches"("status");
CREATE INDEX "enterprise_disbursement_batches_created_at_idx" ON "enterprise_disbursement_batches"("created_at");

-- Individual disbursement rows (one per contractor)
CREATE TABLE "enterprise_disbursement_rows" (
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
CREATE INDEX "enterprise_disbursement_rows_batch_id_idx" ON "enterprise_disbursement_rows"("batch_id");
CREATE INDEX "enterprise_disbursement_rows_status_idx" ON "enterprise_disbursement_rows"("status");
