-- lp_fx_pairs: supported trading pairs for the SimpleFX pool
-- Each row represents one tradeable pair (e.g. nTZS/USDC, nTZS/USDT).
-- Seeded with the existing nTZS/USDC pair from lp_fx_config.mid_rate_tzs.
CREATE TABLE IF NOT EXISTS "lp_fx_pairs" (
  "id"              serial PRIMARY KEY,
  "token1_address"  text NOT NULL,
  "token1_symbol"   text NOT NULL,
  "token1_decimals" integer NOT NULL DEFAULT 18,
  "token2_address"  text NOT NULL,
  "token2_symbol"   text NOT NULL,
  "token2_decimals" integer NOT NULL DEFAULT 6,
  "mid_rate"        numeric(36,18) NOT NULL,
  "is_active"       boolean NOT NULL DEFAULT true,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "lp_fx_pairs_tokens_uq"
  ON "lp_fx_pairs"("token1_address", "token2_address");

-- Seed the initial nTZS/USDC pair from the existing single-row config
INSERT INTO "lp_fx_pairs"
  ("token1_address", "token1_symbol", "token1_decimals",
   "token2_address", "token2_symbol", "token2_decimals",
   "mid_rate", "is_active")
SELECT
  '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688', 'nTZS', 18,
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 6,
  mid_rate_tzs::numeric,
  true
FROM "lp_fx_config"
WHERE id = 1
ON CONFLICT DO NOTHING;

-- lp_pool_positions: per-LP, per-token position in the solver pool.
-- Populated when an LP activates; zeroed when they deactivate.
CREATE TABLE IF NOT EXISTS "lp_pool_positions" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "lp_id"         uuid NOT NULL REFERENCES "lp_accounts"("id") ON DELETE CASCADE,
  "token_address" text NOT NULL,
  "token_symbol"  text NOT NULL,
  "decimals"      integer NOT NULL DEFAULT 18,
  "contributed"   numeric(36,18) NOT NULL DEFAULT 0,
  "earned"        numeric(36,18) NOT NULL DEFAULT 0,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "lp_pool_positions_lp_token_uq"
  ON "lp_pool_positions"("lp_id", "token_address");

CREATE INDEX IF NOT EXISTS "lp_pool_positions_lp_id_idx"
  ON "lp_pool_positions"("lp_id");

CREATE INDEX IF NOT EXISTS "lp_pool_positions_token_address_idx"
  ON "lp_pool_positions"("token_address");
