INSERT INTO lp_fx_pairs
  (token1_address, token1_symbol, token1_decimals,
   token2_address, token2_symbol, token2_decimals,
   mid_rate, is_active)
VALUES
  ('0xF476BA983DE2F1AD532380630e2CF1D1b8b10688', 'NTZS', 18,
   '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 'USDT', 6,
   '3750', true)
ON CONFLICT (token1_address, token2_address) DO NOTHING;
