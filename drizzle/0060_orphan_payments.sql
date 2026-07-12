-- Orphan PSP payments: money that arrived at the PSP with no
-- deposit_request_id in the webhook metadata (e.g. a customer paying the
-- Snippe collection till directly instead of completing the in-app checkout).
-- Parked for backstage review + one-click attach to a 'submitted' deposit,
-- instead of being silently ignored.
CREATE TABLE IF NOT EXISTS orphan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'snippe',
  psp_reference text NOT NULL,
  event_type text,
  amount_tzs bigint NOT NULL,
  currency text NOT NULL DEFAULT 'TZS',
  payer_phone varchar(32),
  payer_name text,
  channel text,
  status text NOT NULL DEFAULT 'unmatched',
  matched_deposit_request_id uuid REFERENCES deposit_requests(id),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  notes text,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orphan_payments_psp_reference_uq ON orphan_payments (provider, psp_reference);
CREATE INDEX IF NOT EXISTS orphan_payments_status_idx ON orphan_payments (status);
