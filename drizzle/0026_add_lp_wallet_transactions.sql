-- lp_wallet_transactions: full audit log of every deposit, withdrawal,
-- activation sweep, and deactivation return for each LP wallet.
CREATE TABLE IF NOT EXISTS "lp_wallet_transactions" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "lp_id"         uuid NOT NULL REFERENCES "lp_accounts"("id") ON DELETE CASCADE,
  "type"          text NOT NULL,
  "source"        text NOT NULL DEFAULT 'onchain',
  "token_address" text NOT NULL,
  "token_symbol"  text NOT NULL,
  "decimals"      integer NOT NULL DEFAULT 18,
  "amount"        numeric(36, 18) NOT NULL,
  "tx_hash"       text,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "lp_wallet_transactions_lp_id_idx"
  ON "lp_wallet_transactions"("lp_id");

CREATE INDEX IF NOT EXISTS "lp_wallet_transactions_type_idx"
  ON "lp_wallet_transactions"("type");

CREATE INDEX IF NOT EXISTS "lp_wallet_transactions_created_at_idx"
  ON "lp_wallet_transactions"("created_at");
