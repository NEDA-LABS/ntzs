-- Add pay_alias to users (unique, nullable — auto-generated on first use)
ALTER TABLE "users" ADD COLUMN "pay_alias" varchar(40);
CREATE UNIQUE INDEX "users_pay_alias_uq" ON "users" ("pay_alias");

-- Add source column to deposit_requests to distinguish self-deposits from collections
ALTER TABLE "deposit_requests" ADD COLUMN "source" text DEFAULT 'self' NOT NULL;

-- Add payer_name for pay-link deposits (who paid)
ALTER TABLE "deposit_requests" ADD COLUMN "payer_name" text;
