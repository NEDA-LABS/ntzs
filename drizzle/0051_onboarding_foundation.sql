DO $$ BEGIN CREATE TYPE "lp_account_type" AS ENUM('standard', 'bank'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "lp_account_status" AS ENUM('onboarding', 'active', 'suspended'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "lp_kyb_status" AS ENUM('not_started', 'submitted', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "lp_accounts" ADD COLUMN IF NOT EXISTS "account_type" "lp_account_type" DEFAULT 'standard' NOT NULL;
--> statement-breakpoint
ALTER TABLE "lp_accounts" ADD COLUMN IF NOT EXISTS "status" "lp_account_status" DEFAULT 'onboarding' NOT NULL;
--> statement-breakpoint
ALTER TABLE "lp_accounts" ADD COLUMN IF NOT EXISTS "kyb_status" "lp_kyb_status" DEFAULT 'not_started' NOT NULL;
--> statement-breakpoint
ALTER TABLE "lp_accounts" ADD COLUMN IF NOT EXISTS "banking_profile" jsonb;
--> statement-breakpoint
ALTER TABLE "lp_accounts" ADD COLUMN IF NOT EXISTS "limits" jsonb;
--> statement-breakpoint
-- Back-fill: existing already-active LPs are 'active', not 'onboarding'.
UPDATE "lp_accounts" SET "status" = 'active' WHERE "is_active" = true;
