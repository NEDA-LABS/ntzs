-- 0065: ramp off-ramp → Selcom spend destinations (Lipa till / bill).
--
-- An off-ramp can now terminate at a merchant Lipa Namba or a biller instead
-- of a mobile-money wallet. The destination is BOUND to the quote (so the fee
-- the quote priced is the fee that executes) and recorded on the settlement
-- with its evidence (actual charges, Selcom receipt).
--
-- Both columns are nullable — existing wallet off-ramps and every current row
-- are untouched. Apply BEFORE setting SELCOM_SPEND_ENABLED=true (the same gate
-- that guards the domestic spend rails, which this reuses).

ALTER TABLE "ramp_quotes"      ADD COLUMN IF NOT EXISTS "destination" jsonb;
ALTER TABLE "ramp_settlements" ADD COLUMN IF NOT EXISTS "destination" jsonb;
