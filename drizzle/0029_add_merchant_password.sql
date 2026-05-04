-- Add password_hash to merchant_accounts for email+password login
ALTER TABLE "merchant_accounts" ADD COLUMN IF NOT EXISTS "password_hash" text;
