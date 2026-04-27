-- Add chain column to all LP tables (defaults to 'base' for all existing rows)
ALTER TABLE lp_fx_pairs ADD COLUMN IF NOT EXISTS chain chain NOT NULL DEFAULT 'base';
ALTER TABLE lp_pool_positions ADD COLUMN IF NOT EXISTS chain chain NOT NULL DEFAULT 'base';
ALTER TABLE lp_fills ADD COLUMN IF NOT EXISTS chain chain NOT NULL DEFAULT 'base';
ALTER TABLE lp_wallet_transactions ADD COLUMN IF NOT EXISTS chain chain NOT NULL DEFAULT 'base';

-- Replace pair uniqueness constraint to include chain
-- (same token pair can now exist on different chains)
DROP INDEX IF EXISTS lp_fx_pairs_tokens_uq;
CREATE UNIQUE INDEX IF NOT EXISTS lp_fx_pairs_chain_tokens_uq
  ON lp_fx_pairs(chain, token1_address, token2_address);

-- Replace position uniqueness constraint to include chain
-- (LP can hold the same token symbol on multiple chains)
DROP INDEX IF EXISTS lp_pool_positions_lp_token_uq;
CREATE UNIQUE INDEX IF NOT EXISTS lp_pool_positions_lp_chain_token_uq
  ON lp_pool_positions(lp_id, chain, token_address);

-- BNB USDT pair: nTZS side lives on Base, USDT side on BNB Smart Chain
-- token1 = NTZS (Base, 18 dec), token2 = USDT BEP-20 (BNB, 18 dec)
INSERT INTO lp_fx_pairs
  (chain, token1_address, token1_symbol, token1_decimals,
   token2_address, token2_symbol, token2_decimals,
   mid_rate, is_active)
VALUES
  ('bnb', '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688', 'NTZS', 18,
   '0x55d398326f99059fF775485246999027B3197955', 'USDT', 18,
   '3750', true)
ON CONFLICT DO NOTHING;
