DO $$ BEGIN CREATE TYPE "lp_member_role" AS ENUM('owner', 'operator', 'approver', 'viewer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "lp_member_status" AS ENUM('invited', 'active', 'disabled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lp_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lp_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" "lp_member_role" DEFAULT 'owner' NOT NULL,
	"status" "lp_member_status" DEFAULT 'active' NOT NULL,
	"invited_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "lp_members" ADD CONSTRAINT "lp_members_lp_id_lp_accounts_id_fk"
		FOREIGN KEY ("lp_id") REFERENCES "lp_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lp_members_email_uq" ON "lp_members" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lp_members_lp_id_idx" ON "lp_members" ("lp_id");
--> statement-breakpoint
-- Back-fill: every existing account becomes its own owner.
INSERT INTO "lp_members" ("lp_id", "email", "role", "status")
	SELECT "id", "email", 'owner', 'active' FROM "lp_accounts"
	ON CONFLICT ("email") DO NOTHING;
