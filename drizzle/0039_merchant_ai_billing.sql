-- merchant_ai_usage: monthly per-merchant usage tracking for Ubongo AI
CREATE TABLE IF NOT EXISTS merchant_ai_usage (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id uuid        NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  period      varchar(7)  NOT NULL, -- 'YYYY-MM'
  request_count       integer NOT NULL DEFAULT 0,
  free_request_count  integer NOT NULL DEFAULT 0,
  paid_request_count  integer NOT NULL DEFAULT 0,
  total_tokens        integer NOT NULL DEFAULT 0,
  total_fee_tzs       bigint  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_ai_usage_merchant_period_uq UNIQUE (merchant_id, period)
);

CREATE INDEX IF NOT EXISTS merchant_ai_usage_merchant_id_idx ON merchant_ai_usage(merchant_id);
CREATE INDEX IF NOT EXISTS merchant_ai_usage_period_idx       ON merchant_ai_usage(period);

-- merchant_platform_fees: ledger of fees deducted from merchant settlement → platform treasury
CREATE TABLE IF NOT EXISTS merchant_platform_fees (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id uuid        NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  amount_tzs  bigint      NOT NULL,
  reason      varchar(50) NOT NULL DEFAULT 'ai_chat',
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_platform_fees_merchant_id_idx ON merchant_platform_fees(merchant_id);
CREATE INDEX IF NOT EXISTS merchant_platform_fees_created_at_idx  ON merchant_platform_fees(created_at);
