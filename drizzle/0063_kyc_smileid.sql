-- SmileID international KYC (Phase 1): country routing + async doc-verification cases.
-- Hand-authored per the 0050+ convention (journal stale at idx 49). Idempotent.

-- Country of the identity claim (ISO 3166-1 alpha-2). Every pre-international
-- case was Tanzanian by construction, so the backfilling default is 'TZ'.
ALTER TABLE "kyc_cases" ADD COLUMN IF NOT EXISTS "country" text NOT NULL DEFAULT 'TZ';
--> statement-breakpoint

-- Document/ID type backing the case (SmileID vocabulary: IDENTITY_CARD,
-- PASSPORT, NIN, ...). NULL on legacy NIDA cases — the NIDA number itself.
ALTER TABLE "kyc_cases" ADD COLUMN IF NOT EXISTS "id_type" text;
--> statement-breakpoint

-- SmileID user handle echoed on result webhooks — fallback correlation key.
-- provider_reference keeps holding the vendor job reference (job_id).
ALTER TABLE "kyc_cases" ADD COLUMN IF NOT EXISTS "provider_user_id" text;
--> statement-breakpoint

-- Async document verification opens the case BEFORE any ID number is known:
-- the number arrives extracted from the document on the result webhook.
ALTER TABLE "kyc_cases" ALTER COLUMN "national_id" DROP NOT NULL;
--> statement-breakpoint

-- Webhook lookup path: resolve a completing job to its case without a scan.
CREATE INDEX IF NOT EXISTS "kyc_cases_provider_reference_idx" ON "kyc_cases" ("provider_reference");
