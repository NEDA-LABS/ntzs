-- On-ramp platform fee split (mirrors the off-ramp split on burn_requests).
-- neda_fee_tzs     = NEDA's protocol cut, skimmed in nTZS to the platform treasury
-- fee_tx_hash      = nTZS transfer of the partner's share
-- neda_fee_tx_hash = nTZS transfer of NEDA's share
ALTER TABLE ramp_settlements
  ADD COLUMN IF NOT EXISTS neda_fee_tzs bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_tx_hash text,
  ADD COLUMN IF NOT EXISTS neda_fee_tx_hash text;
