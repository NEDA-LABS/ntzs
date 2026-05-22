-- Extend merchant_accounts: settlement lock + withdrawal cap
ALTER TABLE merchant_accounts
  ADD COLUMN lender_controls_settlement boolean NOT NULL DEFAULT false,
  ADD COLUMN withdrawal_limit_tzs bigint NOT NULL DEFAULT 0;

-- Extend enterprise_loan_agreements: flat interest rate
ALTER TABLE enterprise_loan_agreements
  ADD COLUMN interest_rate_pct integer NOT NULL DEFAULT 0,
  ADD COLUMN interest_tzs bigint NOT NULL DEFAULT 0,
  ADD COLUMN total_owed_tzs bigint NOT NULL DEFAULT 0;

-- Backfill: existing rows have no interest, so total_owed = principal
UPDATE enterprise_loan_agreements SET total_owed_tzs = principal_tzs WHERE total_owed_tzs = 0;

-- New table: two-sided invite/application marketplace
CREATE TABLE enterprise_merchant_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprise_accounts(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  direction text NOT NULL,       -- 'invite' | 'application'
  status text NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected | cancelled
  proposed_split_pct integer,
  message text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one pending record per lender/merchant pair
CREATE UNIQUE INDEX enterprise_merchant_applications_pending_uq
  ON enterprise_merchant_applications (enterprise_id, merchant_id)
  WHERE status = 'pending';

CREATE INDEX enterprise_merchant_applications_enterprise_id_idx ON enterprise_merchant_applications (enterprise_id);
CREATE INDEX enterprise_merchant_applications_merchant_id_idx ON enterprise_merchant_applications (merchant_id);
CREATE INDEX enterprise_merchant_applications_status_idx ON enterprise_merchant_applications (status);
