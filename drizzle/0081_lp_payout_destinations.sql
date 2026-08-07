-- Saved payout destinations, and a USD ceiling to sit beside the TZS one.
--
-- A bank off-ramping stablecoin to a counterparty sends to the same address
-- every cycle. Retyping a 42-character address each time is the
-- single riskiest step in the whole flow: it is irreversible, it is unverified,
-- and a transposition sends real money to nobody. The same applies to the
-- shilling rail, where the settlement account number is retyped just as often.
--
-- So a destination is saved once, named, and picked from a list thereafter.
-- Address and account_number are deliberately NOT unique — the same address may
-- legitimately be saved twice under different names during a migration between
-- custodians. The label is what must be unambiguous, since that is what an
-- operator reads when choosing.
CREATE TABLE IF NOT EXISTS lp_payout_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_id uuid NOT NULL REFERENCES lp_accounts(id) ON DELETE CASCADE,

  -- 'crypto' = chain + address; 'bank' = bank_code + account_number.
  kind text NOT NULL,
  label text NOT NULL,

  chain text,
  address text,

  bank_code text,
  account_number text,

  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lp_payout_destinations_kind_ck CHECK (kind IN ('crypto', 'bank')),
  CONSTRAINT lp_payout_destinations_shape_ck CHECK (
    (kind = 'crypto' AND chain IS NOT NULL AND address IS NOT NULL) OR
    (kind = 'bank'   AND bank_code IS NOT NULL AND account_number IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS lp_payout_destinations_lp_id_idx
  ON lp_payout_destinations (lp_id);

-- Two destinations an operator cannot tell apart are worse than none.
CREATE UNIQUE INDEX IF NOT EXISTS lp_payout_destinations_label_uq
  ON lp_payout_destinations (lp_id, lower(label));

-- The existing ceiling is denominated in shillings, so it says nothing about a
-- USDC transfer. A bank moving stablecoin float moves dollars, and an uncapped
-- dollar leg beside a capped shilling one is a gap, not a policy.
ALTER TABLE lp_accounts ADD COLUMN IF NOT EXISTS approval_threshold_usd bigint;

COMMENT ON COLUMN lp_accounts.approval_threshold_usd IS
  'Stablecoin withdrawals at or above this USD amount require a second approver even for owners. NULL = role-based policy only.';
