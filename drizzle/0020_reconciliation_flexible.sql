-- Make tx_hash nullable (was NOT NULL)
ALTER TABLE "reconciliation_entries" ALTER COLUMN "tx_hash" DROP NOT NULL;

-- Drop old unconditional unique index and replace with partial unique (only when non-null)
DROP INDEX IF EXISTS "reconciliation_entries_tx_hash_uq";
CREATE UNIQUE INDEX "reconciliation_entries_tx_hash_uq" ON "reconciliation_entries"("tx_hash") WHERE "tx_hash" IS NOT NULL;

-- Make to_address nullable (batch/opening_balance entries have no single recipient)
ALTER TABLE "reconciliation_entries" ALTER COLUMN "to_address" DROP NOT NULL;

-- Add contract_address column for future-proof tracking of which contract each entry applies to
ALTER TABLE "reconciliation_entries" ADD COLUMN IF NOT EXISTS "contract_address" text;

-- Add opening_balance entry type
ALTER TYPE "reconciliation_entry_type" ADD VALUE IF NOT EXISTS 'opening_balance';
