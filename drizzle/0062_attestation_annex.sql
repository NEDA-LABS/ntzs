-- 0062: attestation annex — reserve composition + reconciliation-to-1:1
--
-- Adds the JSONB annex persisted with each daily attestation row:
--   { pots[], nettings{}, grossReservesTzs, backingReservesTzs,
--     totalSupplyTzs, effectiveObligationsTzs, rawDeviationPct,
--     adjustedCoveragePct, residualPct }
-- (shape defined in apps/web/src/lib/attestation-math.ts).
--
-- APPLY MANUALLY in Neon (drizzle journal is not in use for prod).
-- Code is fail-soft pre-apply: the attestation writer catches the missing
-- column and stores the legacy row, so applying this only upgrades history —
-- nothing breaks either side of the apply.

ALTER TABLE attestations ADD COLUMN IF NOT EXISTS annex jsonb;
