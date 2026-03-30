CREATE TYPE "public"."fund_manager_status" AS ENUM('active', 'paused', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."lp_kyc_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."savings_position_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."savings_product_status" AS ENUM('active', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."savings_tx_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."savings_tx_type" AS ENUM('deposit', 'withdrawal', 'yield_credit');--> statement-breakpoint
ALTER TYPE "public"."reconciliation_entry_type" ADD VALUE 'opening_balance' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'fund_manager';--> statement-breakpoint
ALTER TYPE "public"."wallet_provider" ADD VALUE 'platform_hd';--> statement-breakpoint
CREATE TABLE "fund_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_email" varchar(320),
	"contact_phone" varchar(32),
	"license_number" text,
	"agreement_signed_at" timestamp with time zone,
	"tvl_limit_tzs" bigint,
	"status" "fund_manager_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lp_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" text,
	"wallet_address" text NOT NULL,
	"wallet_index" integer NOT NULL,
	"bid_bps" integer DEFAULT 120 NOT NULL,
	"ask_bps" integer DEFAULT 150 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"kyc_status" "lp_kyc_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lp_next_wallet_index" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"next_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lp_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_sub_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"wallet_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"principal_tzs" bigint DEFAULT 0 NOT NULL,
	"accrued_yield_tzs" bigint DEFAULT 0 NOT NULL,
	"total_deposited_tzs" bigint DEFAULT 0 NOT NULL,
	"total_withdrawn_tzs" bigint DEFAULT 0 NOT NULL,
	"total_yield_claimed_tzs" bigint DEFAULT 0 NOT NULL,
	"annual_rate_bps" integer NOT NULL,
	"status" "savings_position_status" DEFAULT 'active' NOT NULL,
	"last_accrual_at" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"matures_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_manager_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"annual_rate_bps" integer NOT NULL,
	"lock_days" integer DEFAULT 0 NOT NULL,
	"min_deposit_tzs" bigint DEFAULT 0 NOT NULL,
	"max_deposit_tzs" bigint,
	"status" "savings_product_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "savings_tx_type" NOT NULL,
	"status" "savings_tx_status" DEFAULT 'pending' NOT NULL,
	"amount_tzs" bigint NOT NULL,
	"psp_reference" text,
	"mint_tx_hash" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yield_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"date" text NOT NULL,
	"principal_tzs" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"accrued_tzs" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "reconciliation_entries_tx_hash_uq";--> statement-breakpoint
DROP INDEX "users_email_uq";--> statement-breakpoint
ALTER TABLE "reconciliation_entries" ALTER COLUMN "tx_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_entries" ALTER COLUMN "to_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "burn_requests" ADD COLUMN "platform_fee_tzs" bigint;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD COLUMN "minted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD COLUMN "source" text DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD COLUMN "payer_name" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "next_sub_wallet_index" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "suspend_reason" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "daily_limit_tzs" bigint;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "contract_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "treasury_wallet_address" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "fee_percent" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "payout_phone" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "payout_type" text DEFAULT 'mobile';--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "payout_bank_account" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "payout_bank_name" text;--> statement-breakpoint
ALTER TABLE "reconciliation_entries" ADD COLUMN "contract_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pay_alias" varchar(40);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "fund_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "frozen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_sub_wallets" ADD CONSTRAINT "partner_sub_wallets_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_positions" ADD CONSTRAINT "savings_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_positions" ADD CONSTRAINT "savings_positions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_positions" ADD CONSTRAINT "savings_positions_product_id_savings_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."savings_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_products" ADD CONSTRAINT "savings_products_fund_manager_id_fund_managers_id_fk" FOREIGN KEY ("fund_manager_id") REFERENCES "public"."fund_managers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_transactions" ADD CONSTRAINT "savings_transactions_position_id_savings_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."savings_positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_transactions" ADD CONSTRAINT "savings_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_accruals" ADD CONSTRAINT "yield_accruals_position_id_savings_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."savings_positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fund_managers_status_idx" ON "fund_managers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "lp_accounts_email_uq" ON "lp_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "lp_accounts_wallet_index_uq" ON "lp_accounts" USING btree ("wallet_index");--> statement-breakpoint
CREATE UNIQUE INDEX "lp_accounts_wallet_address_uq" ON "lp_accounts" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "lp_accounts_kyc_status_idx" ON "lp_accounts" USING btree ("kyc_status");--> statement-breakpoint
CREATE INDEX "lp_otp_codes_email_idx" ON "lp_otp_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "lp_otp_codes_expires_at_idx" ON "lp_otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "partner_sub_wallets_partner_id_idx" ON "partner_sub_wallets" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_positions_user_product_uq" ON "savings_positions" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "savings_positions_status_idx" ON "savings_positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "savings_positions_product_id_idx" ON "savings_positions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "savings_positions_last_accrual_idx" ON "savings_positions" USING btree ("last_accrual_at");--> statement-breakpoint
CREATE INDEX "savings_products_fund_manager_id_idx" ON "savings_products" USING btree ("fund_manager_id");--> statement-breakpoint
CREATE INDEX "savings_products_status_idx" ON "savings_products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "savings_transactions_position_id_idx" ON "savings_transactions" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "savings_transactions_user_id_idx" ON "savings_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "savings_transactions_type_idx" ON "savings_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "savings_transactions_status_idx" ON "savings_transactions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "yield_accruals_position_date_uq" ON "yield_accruals" USING btree ("position_id","date");--> statement-breakpoint
CREATE INDEX "yield_accruals_position_id_idx" ON "yield_accruals" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "yield_accruals_date_idx" ON "yield_accruals" USING btree ("date");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_fund_manager_id_fund_managers_id_fk" FOREIGN KEY ("fund_manager_id") REFERENCES "public"."fund_managers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_pay_alias_uq" ON "users" USING btree ("pay_alias");