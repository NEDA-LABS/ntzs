-- Migration 0018: Fund managers + savings products
-- Replaces the single savings_rate_config with a proper multi-manager model.

-- 1. Enums
CREATE TYPE "fund_manager_status" AS ENUM ('active', 'paused', 'terminated');
CREATE TYPE "savings_product_status" AS ENUM ('active', 'paused', 'closed');

-- 2. Fund managers table
CREATE TABLE "fund_managers" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"                 text NOT NULL,
  "contact_email"        varchar(320),
  "contact_phone"        varchar(32),
  "license_number"       text,
  "agreement_signed_at"  timestamptz,
  "tvl_limit_tzs"        bigint,
  "status"               fund_manager_status NOT NULL DEFAULT 'active',
  "notes"                text,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "fund_managers_status_idx" ON "fund_managers" ("status");

-- 3. Savings products table
CREATE TABLE "savings_products" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "fund_manager_id"  uuid NOT NULL REFERENCES "fund_managers"("id") ON DELETE RESTRICT,
  "name"             text NOT NULL,
  "description"      text,
  "annual_rate_bps"  integer NOT NULL,
  "lock_days"        integer NOT NULL DEFAULT 0,
  "min_deposit_tzs"  bigint NOT NULL DEFAULT 0,
  "max_deposit_tzs"  bigint,
  "status"           savings_product_status NOT NULL DEFAULT 'active',
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "savings_products_fund_manager_id_idx" ON "savings_products" ("fund_manager_id");
CREATE INDEX "savings_products_status_idx"           ON "savings_products" ("status");

-- 4. Seed: Justin's fund manager + first product (Flexible Savings 10% p.a.)
DO $$
DECLARE
  v_manager_id uuid;
BEGIN
  INSERT INTO "fund_managers" ("name", "notes")
  VALUES ('Justin — Licensed Fund Manager', 'Investment/fund management agreement. 100B+ TZS AUM. Open-ended structure per legal advice.')
  RETURNING id INTO v_manager_id;

  INSERT INTO "savings_products" ("fund_manager_id", "name", "description", "annual_rate_bps", "lock_days", "min_deposit_tzs")
  VALUES (
    v_manager_id,
    'Flexible Savings',
    'Earn 10% p.a. on your TZS balance. Withdraw any time.',
    1000,
    0,
    1000
  );
END $$;

-- 5. Evolve savings_positions: add product_id + matures_at, fix unique index
ALTER TABLE "savings_positions"
  ADD COLUMN "product_id" uuid REFERENCES "savings_products"("id") ON DELETE RESTRICT,
  ADD COLUMN "matures_at" timestamptz;

-- Back-fill product_id for any existing rows (table was just created, should be empty,
-- but this ensures the migration is safe if run against a pre-populated table).
UPDATE "savings_positions"
SET "product_id" = (SELECT id FROM "savings_products" LIMIT 1)
WHERE "product_id" IS NULL;

ALTER TABLE "savings_positions" ALTER COLUMN "product_id" SET NOT NULL;

-- Replace old single-user unique index with per-(user, product) unique index
DROP INDEX IF EXISTS "savings_positions_user_uq";
CREATE UNIQUE INDEX "savings_positions_user_product_uq" ON "savings_positions" ("user_id", "product_id");
CREATE INDEX "savings_positions_product_id_idx" ON "savings_positions" ("product_id");

-- 6. Drop the now-superseded savings_rate_config table
DROP INDEX IF EXISTS "savings_rate_config_effective_from_idx";
DROP TABLE IF EXISTS "savings_rate_config";
