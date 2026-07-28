-- 0068: agent float (SmartWakala) — disburse from a partner SUB-WALLET.
--
-- A partner (e.g. a licensed PSP serving mobile-money agents) holds one
-- sub-wallet per agent. That sub-wallet IS the agent's unified nTZS float, and
-- it can pay any mobile wallet, any till, or any biller.
--
-- ⚠ WHY THIS COLUMN EXISTS — READ BEFORE CHANGING.
-- Sub-wallets sit under a partner treasury, so the per-USER sandbox caps do
-- not naturally apply to them. That would make them a route around BoT
-- Parameters #4/#5 (daily/monthly per-participant limits) — which we will not
-- build. Tagging every burn with its funding sub-wallet is what lets the same
-- caps be counted per agent float, so a float is capped exactly as a user is
-- and a second sub-wallet creates another participant rather than fresh
-- headroom.
--
-- Nullable and defaulted: existing rows and every user-funded path are
-- untouched.

ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "sub_wallet_id" uuid
  REFERENCES "partner_sub_wallets"("id") ON DELETE SET NULL;

-- Serves the per-float period-limit query (subject + window + status).
CREATE INDEX IF NOT EXISTS "burn_requests_sub_wallet_created_idx"
  ON "burn_requests" ("sub_wallet_id", "created_at");
