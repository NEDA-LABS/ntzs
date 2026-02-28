ALTER TABLE "partners" ADD COLUMN "suspended_at" timestamp with time zone;
ALTER TABLE "partners" ADD COLUMN "suspend_reason" text;
ALTER TABLE "partners" ADD COLUMN "daily_limit_tzs" bigint;
ALTER TABLE "partners" ADD COLUMN "contract_signed_at" timestamp with time zone;
