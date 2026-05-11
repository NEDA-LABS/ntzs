ALTER TYPE "public"."user_role" ADD VALUE 'bot_regulator';--> statement-breakpoint
ALTER TABLE "lp_fills" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "lp_fills" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "merchant_payment_links" ADD COLUMN "promo_url" text;--> statement-breakpoint
ALTER TABLE "lp_fills" ADD CONSTRAINT "lp_fills_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;