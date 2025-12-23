CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('bank', 'platform');--> statement-breakpoint
CREATE TYPE "public"."chain" AS ENUM('base', 'bnb', 'eth');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('submitted', 'kyc_pending', 'kyc_approved', 'kyc_rejected', 'awaiting_fiat', 'fiat_confirmed', 'bank_approved', 'platform_approved', 'mint_pending', 'mint_processing', 'minted', 'mint_failed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('end_user', 'bank_admin', 'platform_compliance', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."wallet_provider" AS ENUM('external', 'coinbase_embedded');--> statement-breakpoint
CREATE TYPE "public"."wallet_verification_method" AS ENUM('message_signature', 'micro_deposit', 'manual');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_issuance" (
	"day" text PRIMARY KEY NOT NULL,
	"cap_tzs" bigint NOT NULL,
	"reserved_tzs" bigint DEFAULT 0 NOT NULL,
	"issued_tzs" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deposit_request_id" uuid NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"approval_type" "approval_type" NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"chain" "chain" NOT NULL,
	"amount_tzs" bigint NOT NULL,
	"status" "deposit_status" DEFAULT 'submitted' NOT NULL,
	"idempotency_key" text NOT NULL,
	"fiat_confirmed_by_user_id" uuid,
	"fiat_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"national_id" text NOT NULL,
	"status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_reference" text,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kyc_case_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"s3_key" text NOT NULL,
	"content_type" text,
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mint_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deposit_request_id" uuid NOT NULL,
	"chain" "chain" NOT NULL,
	"contract_address" text NOT NULL,
	"tx_hash" text,
	"status" text DEFAULT 'created' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"neon_auth_user_id" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(32),
	"role" "user_role" DEFAULT 'end_user' NOT NULL,
	"bank_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"provider" "wallet_provider" DEFAULT 'external' NOT NULL,
	"provider_user_ref" text,
	"provider_wallet_ref" text,
	"verified_at" timestamp with time zone,
	"verification_method" "wallet_verification_method",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_approvals" ADD CONSTRAINT "deposit_approvals_deposit_request_id_deposit_requests_id_fk" FOREIGN KEY ("deposit_request_id") REFERENCES "public"."deposit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_approvals" ADD CONSTRAINT "deposit_approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_fiat_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("fiat_confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_cases" ADD CONSTRAINT "kyc_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_cases" ADD CONSTRAINT "kyc_cases_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_kyc_case_id_kyc_cases_id_fk" FOREIGN KEY ("kyc_case_id") REFERENCES "public"."kyc_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint_transactions" ADD CONSTRAINT "mint_transactions_deposit_request_id_deposit_requests_id_fk" FOREIGN KEY ("deposit_request_id") REFERENCES "public"."deposit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "banks_name_uq" ON "banks" USING btree ("name");--> statement-breakpoint
CREATE INDEX "daily_issuance_day_idx" ON "daily_issuance" USING btree ("day");--> statement-breakpoint
CREATE INDEX "deposit_approvals_deposit_request_id_idx" ON "deposit_approvals" USING btree ("deposit_request_id");--> statement-breakpoint
CREATE INDEX "deposit_approvals_type_idx" ON "deposit_approvals" USING btree ("approval_type");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_approvals_request_type_uq" ON "deposit_approvals" USING btree ("deposit_request_id","approval_type");--> statement-breakpoint
CREATE INDEX "deposit_requests_user_id_idx" ON "deposit_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deposit_requests_bank_id_idx" ON "deposit_requests" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "deposit_requests_status_idx" ON "deposit_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_requests_user_idempotency_uq" ON "deposit_requests" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "kyc_cases_user_id_idx" ON "kyc_cases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kyc_cases_status_idx" ON "kyc_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kyc_documents_kyc_case_id_idx" ON "kyc_documents" USING btree ("kyc_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mint_transactions_deposit_request_uq" ON "mint_transactions" USING btree ("deposit_request_id");--> statement-breakpoint
CREATE INDEX "mint_transactions_tx_hash_idx" ON "mint_transactions" USING btree ("tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_neon_auth_user_id_uq" ON "users" USING btree ("neon_auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_bank_id_idx" ON "users" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "wallets_user_id_idx" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_chain_address_uq" ON "wallets" USING btree ("chain","address");