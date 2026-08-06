-- Provider-declared reserve balances, recorded by an operator.
--
-- When a provider's API is unavailable but the provider still tells us what we
-- hold — a daily statement, a CSV, a portal screenshot — that figure is real
-- evidence. It is better than carrying yesterday's reading forward: it is
-- current, and it comes from the custodian itself. A bank statement is the
-- classic form of reserve evidence; this is the same thing.
--
-- It is NOT as good as an API read, because a human transcribed it. So the
-- attestation still marks it as not-read-live, records who entered it and
-- against which statement, and the figure ages out on the same clock as a
-- carried-forward reading — if the statements stop arriving, we stop using
-- the last one.
--
-- as_of is the STATEMENT's date, never the entry time. Entering Tuesday's
-- statement on Thursday must not make it look like Thursday's balance.
CREATE TABLE IF NOT EXISTS reserve_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pot_key text NOT NULL,
  amount_tzs numeric(36,2) NOT NULL,
  as_of timestamptz NOT NULL,
  reference text,
  note text,
  entered_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The newest statement for a pot, by the statement's own date. A later entry
-- for the same date is a correction and wins on created_at.
CREATE INDEX IF NOT EXISTS reserve_statements_pot_as_of_idx
  ON reserve_statements (pot_key, as_of DESC, created_at DESC);
