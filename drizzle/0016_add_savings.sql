-- Migration 0016: Savings / Yield feature
-- Tables: savings_rate_config, savings_positions, savings_transactions, yield_accruals

CREATE TYPE "savings_position_status" AS ENUM ('active', 'closed');
CREATE TYPE "savings_tx_type" AS ENUM ('deposit', 'withdrawal', 'yield_credit');
CREATE TYPE "savings_tx_status" AS ENUM ('pending', 'completed', 'failed');

-- Platform-wide APY config. Insert a new row to change the rate.
CREATE TABLE "savings_rate_config" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "annual_rate_bps"  integer NOT NULL,
  "effective_from"   timestamptz NOT NULL DEFAULT now(),
  "set_by_user_id"   uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "notes"            text,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "savings_rate_config_effective_from_idx"
  ON "savings_rate_config" ("effective_from");

-- Seed the initial rate at 10% p.a. (1000 bps)
INSERT INTO "savings_rate_config" ("annual_rate_bps", "notes")
VALUES (1000, 'Initial rate: 10% p.a. — fund management agreement with licensed manager');

-- One savings position per user.
CREATE TABLE "savings_positions" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                 uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "wallet_id"               uuid NOT NULL REFERENCES "wallets"("id") ON DELETE RESTRICT,

  "principal_tzs"           bigint NOT NULL DEFAULT 0,
  "accrued_yield_tzs"       bigint NOT NULL DEFAULT 0,

  "total_deposited_tzs"     bigint NOT NULL DEFAULT 0,
  "total_withdrawn_tzs"     bigint NOT NULL DEFAULT 0,
  "total_yield_claimed_tzs" bigint NOT NULL DEFAULT 0,

  "annual_rate_bps"         integer NOT NULL,

  "status"                  savings_position_status NOT NULL DEFAULT 'active',

  "last_accrual_at"         timestamptz,
  "opened_at"               timestamptz NOT NULL DEFAULT now(),
  "closed_at"               timestamptz,

  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "savings_positions_user_uq"
  ON "savings_positions" ("user_id");

CREATE INDEX "savings_positions_status_idx"
  ON "savings_positions" ("status");

CREATE INDEX "savings_positions_last_accrual_idx"
  ON "savings_positions" ("last_accrual_at");

-- Every movement in or out of a savings position.
CREATE TABLE "savings_transactions" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "position_id"   uuid NOT NULL REFERENCES "savings_positions"("id") ON DELETE RESTRICT,
  "user_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,

  "type"          savings_tx_type NOT NULL,
  "status"        savings_tx_status NOT NULL DEFAULT 'pending',

  "amount_tzs"    bigint NOT NULL,

  "psp_reference" text,
  "mint_tx_hash"  text,
  "notes"         text,

  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "savings_transactions_position_id_idx" ON "savings_transactions" ("position_id");
CREATE INDEX "savings_transactions_user_id_idx"     ON "savings_transactions" ("user_id");
CREATE INDEX "savings_transactions_type_idx"        ON "savings_transactions" ("type");
CREATE INDEX "savings_transactions_status_idx"      ON "savings_transactions" ("status");

-- Daily yield accrual log — one row per position per day. Full audit trail.
CREATE TABLE "yield_accruals" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "position_id"    uuid NOT NULL REFERENCES "savings_positions"("id") ON DELETE RESTRICT,

  "date"           text NOT NULL,          -- YYYY-MM-DD UTC

  "principal_tzs"  bigint NOT NULL,
  "rate_bps"       integer NOT NULL,
  "accrued_tzs"    bigint NOT NULL,

  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "yield_accruals_position_date_uq" ON "yield_accruals" ("position_id", "date");
CREATE INDEX "yield_accruals_position_id_idx"         ON "yield_accruals" ("position_id");
CREATE INDEX "yield_accruals_date_idx"                ON "yield_accruals" ("date");
