-- 0064: spend-target columns on burn_requests — the "spend your nTZS" rails
-- (burn → Selcom lipa/bill payment) reuse the burn + revert machinery, so a
-- spend is a burn_requests row with a different fiat leg.
--
-- payout_kind: 'wallet' (classic withdrawal payout) | 'lipa' | 'bill'
-- spend:       target descriptor + disclosure snapshot (JSONB)
--
-- Both additions are nullable/defaulted — existing rows and code paths are
-- untouched. Apply BEFORE setting SELCOM_SPEND_ENABLED=true.

ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "payout_kind" text NOT NULL DEFAULT 'wallet';
ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "spend" jsonb;

CREATE INDEX IF NOT EXISTS "burn_requests_payout_kind_payout_status_idx"
  ON "burn_requests" ("payout_kind", "payout_status");
