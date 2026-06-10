-- Brute-force protection for OTP sign-in: track failed verification attempts
-- per issued code so a code can be locked after a small number of wrong guesses.
-- Backward-compatible: existing rows default to 0 attempts.
ALTER TABLE "merchant_otp_codes"   ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "enterprise_otp_codes" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "lp_otp_codes"         ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
