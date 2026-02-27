CREATE TYPE "public"."enforcement_action_type" AS ENUM('freeze', 'unfreeze', 'blacklist', 'unblacklist', 'wipe_blacklisted');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('pending', 'submitted', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
ALTER TYPE "public"."psp_provider" ADD VALUE 'snippe';--> statement-breakpoint
ALTER TYPE "public"."psp_provider" ADD VALUE 'snippe_card';--> statement-breakpoint
CREATE TABLE "enforcement_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type" "enforcement_action_type" NOT NULL,
	"chain" "chain" NOT NULL,
	"contract_address" text NOT NULL,
	"target_address" text NOT NULL,
	"tx_hash" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"wallet_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"response_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" varchar(320),
	"password_hash" text,
	"api_key_hash" text NOT NULL,
	"api_key_prefix" varchar(20),
	"webhook_url" text,
	"webhook_secret" text,
	"encrypted_hd_seed" text,
	"next_wallet_index" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"amount_tzs" bigint NOT NULL,
	"tx_hash" text,
	"status" "transfer_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "burn_requests" ADD COLUMN "recipient_phone" varchar(32);--> statement-breakpoint
ALTER TABLE "burn_requests" ADD COLUMN "payout_reference" text;--> statement-breakpoint
ALTER TABLE "burn_requests" ADD COLUMN "payout_status" text;--> statement-breakpoint
ALTER TABLE "burn_requests" ADD COLUMN "payout_error" text;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_users" ADD CONSTRAINT "partner_users_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_users" ADD CONSTRAINT "partner_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_webhook_events" ADD CONSTRAINT "partner_webhook_events_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enforcement_actions_tx_hash_uq" ON "enforcement_actions" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "enforcement_actions_chain_idx" ON "enforcement_actions" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "enforcement_actions_action_type_idx" ON "enforcement_actions" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "enforcement_actions_target_address_idx" ON "enforcement_actions" USING btree ("target_address");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_users_partner_external_uq" ON "partner_users" USING btree ("partner_id","external_id");--> statement-breakpoint
CREATE INDEX "partner_users_user_id_idx" ON "partner_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "partner_users_partner_id_idx" ON "partner_users" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_webhook_events_partner_id_idx" ON "partner_webhook_events" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_webhook_events_status_idx" ON "partner_webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "partner_webhook_events_next_retry_idx" ON "partner_webhook_events" USING btree ("next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_api_key_hash_uq" ON "partners" USING btree ("api_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_email_uq" ON "partners" USING btree ("email");--> statement-breakpoint
CREATE INDEX "partners_name_idx" ON "partners" USING btree ("name");--> statement-breakpoint
CREATE INDEX "transfers_from_user_id_idx" ON "transfers" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "transfers_to_user_id_idx" ON "transfers" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "transfers_status_idx" ON "transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transfers_partner_id_idx" ON "transfers" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "transfers_tx_hash_idx" ON "transfers" USING btree ("tx_hash");--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;