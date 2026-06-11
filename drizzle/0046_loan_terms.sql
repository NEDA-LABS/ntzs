-- Loan term for lender aging/overdue analytics.
-- term_days = agreed duration; due_at = repayment deadline (set when a term is
-- configured). Backward-compatible: existing loans have no term (NULL) until set.
ALTER TABLE "enterprise_loan_agreements" ADD COLUMN IF NOT EXISTS "term_days" integer;
ALTER TABLE "enterprise_loan_agreements" ADD COLUMN IF NOT EXISTS "due_at" timestamptz;
