DO $$ BEGIN CREATE TYPE "lp_kyb_doc_status" AS ENUM('submitted', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lp_kyb_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lp_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"file_url" text NOT NULL,
	"file_name" text,
	"status" "lp_kyb_doc_status" DEFAULT 'submitted' NOT NULL,
	"reviewed_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "lp_kyb_documents" ADD CONSTRAINT "lp_kyb_documents_lp_id_lp_accounts_id_fk"
		FOREIGN KEY ("lp_id") REFERENCES "lp_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lp_kyb_documents_lp_doc_uq" ON "lp_kyb_documents" ("lp_id","doc_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lp_kyb_documents_lp_id_idx" ON "lp_kyb_documents" ("lp_id");
