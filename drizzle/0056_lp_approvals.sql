DO $$ BEGIN CREATE TYPE "lp_approval_status" AS ENUM('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lp_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lp_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb,
	"requested_by_member_id" uuid,
	"status" "lp_approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by_member_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "lp_approvals" ADD CONSTRAINT "lp_approvals_lp_id_lp_accounts_id_fk"
		FOREIGN KEY ("lp_id") REFERENCES "lp_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lp_approvals_lp_status_idx" ON "lp_approvals" ("lp_id","status");
