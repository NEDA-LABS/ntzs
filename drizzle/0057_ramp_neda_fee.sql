-- Ramp corridor: split the platform fee between NEDA and the partner.
-- neda_fee_tzs    = NEDA's protocol cut (minted to the platform treasury)
-- neda_fee_tx_hash = on-chain tx hash for that mint
-- platform_fee_tzs now holds the PARTNER's share (was the whole fee before).
ALTER TABLE burn_requests
  ADD COLUMN IF NOT EXISTS neda_fee_tzs bigint,
  ADD COLUMN IF NOT EXISTS neda_fee_tx_hash text;
