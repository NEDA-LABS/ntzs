-- Add fund_manager value to user_role enum
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'fund_manager';

-- Link users to their fund_manager record
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fund_manager_id" uuid REFERENCES "fund_managers"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "users_fund_manager_id_idx" ON "users"("fund_manager_id");
