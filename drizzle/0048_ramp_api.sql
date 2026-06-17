-- Ramp API — wallet-less USDC ⇄ mobile-money settlement for partners.
-- Hand-written (the drizzle-kit journal is stale; migrations here are applied manually).

CREATE TYPE "public"."ramp_direction" AS ENUM('offramp', 'onramp');--> statement-breakpoint
CREATE TYPE "public"."ramp_settlement_status" AS ENUM('quoted', 'processing', 'swapping', 'paying_out', 'minting', 'completed', 'failed', 'reverted');--> statement-breakpoint

CREATE TABLE "ramp_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"direction" "ramp_direction" NOT NULL,
	"rate_usd_tzs" numeric(18, 6) NOT NULL,
	"usdc_amount" numeric(36, 6) NOT NULL,
	"tzs_amount" bigint NOT NULL,
	"fee_tzs" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "ramp_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"direction" "ramp_direction" NOT NULL,
	"status" "ramp_settlement_status" DEFAULT 'quoted' NOT NULL,
	"quote_id" uuid,
	"rate_usd_tzs" numeric(18, 6) NOT NULL,
	"usdc_amount" numeric(36, 6) NOT NULL,
	"tzs_amount" bigint NOT NULL,
	"fee_tzs" bigint DEFAULT 0 NOT NULL,
	"recipient_phone" varchar(32),
	"destination_address" text,
	"idempotency_key" text,
	"swap_in_tx_hash" text,
	"swap_out_tx_hash" text,
	"burn_request_id" uuid,
	"deposit_request_id" uuid,
	"psp_reference" text,
	"forward_tx_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "ramp_settlement_id" uuid;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD COLUMN IF NOT EXISTS "ramp_settlement_id" uuid;--> statement-breakpoint

ALTER TABLE "ramp_quotes" ADD CONSTRAINT "ramp_quotes_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramp_settlements" ADD CONSTRAINT "ramp_settlements_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramp_settlements" ADD CONSTRAINT "ramp_settlements_quote_id_ramp_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."ramp_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "ramp_quotes_partner_id_idx" ON "ramp_quotes" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "ramp_quotes_expires_at_idx" ON "ramp_quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ramp_settlements_partner_id_idx" ON "ramp_settlements" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "ramp_settlements_status_idx" ON "ramp_settlements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ramp_settlements_created_at_idx" ON "ramp_settlements" USING btree ("created_at");
