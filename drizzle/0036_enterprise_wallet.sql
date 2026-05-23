-- ── 0036: enterprise wallet withdraw requests ───────────────────

CREATE TABLE IF NOT EXISTS enterprise_withdraw_requests (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enterprise_id" uuid NOT NULL REFERENCES "enterprise_accounts"("id") ON DELETE CASCADE,
  "partner_id"    uuid NOT NULL REFERENCES "partners"("id") ON DELETE RESTRICT,
  "amount_tzs"    bigint NOT NULL,
  "payout_method" text NOT NULL DEFAULT 'mobile',  -- 'mobile' | 'bank'
  "payout_phone"  varchar(32),
  "payout_bank_account" text,
  "status"        text NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed
  "notes"         text,
  "processed_at"  timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enterprise_withdraw_requests_enterprise_id_idx ON enterprise_withdraw_requests("enterprise_id");
CREATE INDEX IF NOT EXISTS enterprise_withdraw_requests_status_idx        ON enterprise_withdraw_requests("status");
CREATE INDEX IF NOT EXISTS enterprise_withdraw_requests_created_at_idx    ON enterprise_withdraw_requests("created_at");
