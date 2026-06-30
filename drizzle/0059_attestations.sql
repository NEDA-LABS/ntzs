-- Daily reserve attestation (BoT sandbox Parameter 7 + 16): the 10:00 EAT
-- reconciliation snapshot of nTZS in circulation vs the ring-fenced TZS reserve.
CREATE TABLE IF NOT EXISTS attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date text NOT NULL UNIQUE,
  ntzs_circulation numeric(36,2) NOT NULL,
  tzs_custodial_reserve numeric(36,2) NOT NULL,
  tzs_govt_securities numeric(36,2) NOT NULL DEFAULT 0,
  reserve_total numeric(36,2) NOT NULL,
  deviation_pct numeric(12,6) NOT NULL,
  fully_backed boolean NOT NULL,
  within_kpi boolean NOT NULL,
  block_number bigint,
  supply_source text NOT NULL,
  reserve_source text NOT NULL,
  report_hash text NOT NULL,
  emailed_to text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attestations_report_date_idx ON attestations (report_date);
CREATE INDEX IF NOT EXISTS attestations_created_at_idx ON attestations (created_at);
