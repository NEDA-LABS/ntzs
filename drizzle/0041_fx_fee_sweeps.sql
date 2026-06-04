CREATE TABLE "fx_fee_sweeps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chain" "chain" NOT NULL DEFAULT 'base',
  "token_address" text NOT NULL,
  "token_symbol" text NOT NULL,
  "amount" numeric(36, 18) NOT NULL,
  "tx_hash" text NOT NULL,
  "treasury_address" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "fx_fee_sweeps_chain_token_idx" ON "fx_fee_sweeps" ("chain", "token_address");
CREATE INDEX "fx_fee_sweeps_created_at_idx" ON "fx_fee_sweeps" ("created_at");
