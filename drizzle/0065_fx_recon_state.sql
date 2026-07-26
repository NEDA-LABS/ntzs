-- 0065: fx_recon_state — KV store for the solver-pool reconciliation cron
-- (renumbered 0063 → 0064 → 0065 as main advanced: 0063_kyc_smileid and
-- 0064_spend_target both landed first. Already applied in Neon on 23 Jul 2026
-- under an earlier number, so re-running this is a no-op.)
--
-- /api/cron/fx-pool-reconcile (every 10 min) keeps its state here:
--   sweep_cursor:<chain>  last block scanned by the ERC-20 Transfer-log sweep
--   last_run              latest run summary (surfaced on backstage/simplefx)
--   last_alert            alert fingerprint + timestamp for email dedup
--
-- APPLY MANUALLY in Neon (drizzle journal is not in use for prod).
-- Code is fail-soft pre-apply: the cron still runs the balance-invariant check
-- and alerts on deficits, but skips the Transfer-log sweep (no cursor to
-- persist) and cannot dedupe alerts; backstage shows "no run recorded yet".

CREATE TABLE IF NOT EXISTS fx_recon_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
