-- Track cumulative principal drawn down via merchant financing withdrawals.
-- Revolving facility ceiling: available = principal_tzs - (disbursed_tzs - repaid_tzs).
-- Backward-compatible: existing rows default to 0 drawn.
ALTER TABLE "enterprise_loan_agreements" ADD COLUMN IF NOT EXISTS "disbursed_tzs" bigint NOT NULL DEFAULT 0;
