CREATE TYPE "public"."reconciliation_entry_type" AS ENUM('untracked_mint', 'test_mint', 'manual_correction', 'double_mint', 'other');--> statement-breakpoint
CREATE TABLE "reconciliation_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain" "chain" NOT NULL,
	"tx_hash" text NOT NULL,
	"to_address" text NOT NULL,
	"amount_tzs" bigint NOT NULL,
	"entry_type" "reconciliation_entry_type" NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_entries" ADD CONSTRAINT "reconciliation_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_entries_tx_hash_uq" ON "reconciliation_entries" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "reconciliation_entries_chain_idx" ON "reconciliation_entries" USING btree ("chain");