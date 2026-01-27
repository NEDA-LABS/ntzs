CREATE TYPE "public"."burn_status" AS ENUM('requested', 'approved', 'requires_second_approval', 'rejected', 'burn_submitted', 'burned', 'failed');--> statement-breakpoint
CREATE TABLE "burn_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"chain" "chain" NOT NULL,
	"contract_address" text NOT NULL,
	"amount_tzs" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" "burn_status" DEFAULT 'requested' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"second_approved_by_user_id" uuid,
	"second_approved_at" timestamp with time zone,
	"tx_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "burn_requests" ADD CONSTRAINT "burn_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_requests" ADD CONSTRAINT "burn_requests_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_requests" ADD CONSTRAINT "burn_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_requests" ADD CONSTRAINT "burn_requests_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_requests" ADD CONSTRAINT "burn_requests_second_approved_by_user_id_users_id_fk" FOREIGN KEY ("second_approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "burn_requests_user_id_idx" ON "burn_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "burn_requests_wallet_id_idx" ON "burn_requests" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "burn_requests_status_idx" ON "burn_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "burn_requests_tx_hash_idx" ON "burn_requests" USING btree ("tx_hash");