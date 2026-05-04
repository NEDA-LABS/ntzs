ALTER TYPE "public"."merchant_settlement_status" ADD VALUE 'queued' BEFORE 'processing';--> statement-breakpoint
ALTER TYPE "public"."transfer_token" ADD VALUE 'usdt';--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD COLUMN "settlement_pending_tzs" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_payment_links" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "merchant_payment_links" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "merchant_payment_links" ADD COLUMN "original_amount_tzs" bigint;--> statement-breakpoint
ALTER TABLE "merchant_payment_links" ADD COLUMN "discount_pct" integer DEFAULT 0 NOT NULL;