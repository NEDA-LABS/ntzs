ALTER TABLE "lp_kyb_documents" ADD COLUMN IF NOT EXISTS "file_data" text;
--> statement-breakpoint
ALTER TABLE "lp_kyb_documents" ADD COLUMN IF NOT EXISTS "content_type" text;
--> statement-breakpoint
ALTER TABLE "lp_kyb_documents" ALTER COLUMN "file_url" DROP NOT NULL;
