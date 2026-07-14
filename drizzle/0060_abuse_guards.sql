-- Abuse guards (G3 kill switch + G4 idempotency).
-- Hand-authored to match the 0050–0059 convention (the drizzle journal is stale
-- at idx 49; these later migrations are applied outside it). Idempotent.
--
-- ⚠ PRE-FLIGHT: run scripts/preflight-burn-unique-indexes.ts first. The
-- payout_reference unique index below will fail if any two burn_requests rows
-- already share a non-null payout_reference.

-- G3: operational kill-switch / feature-flag table.
CREATE TABLE IF NOT EXISTS "system_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"note" text,
	"updated_by_user_id" uuid REFERENCES "users"("id"),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- G4: client-supplied idempotency key for withdrawals (nullable; legacy rows stay null).
ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint

-- A double-submit of the same withdrawal is rejected before any burn.
-- NULLs are distinct in Postgres, so legacy rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "burn_requests_user_idempotency_uq"
	ON "burn_requests" USING btree ("user_id","idempotency_key");
--> statement-breakpoint

-- One PSP payout reference can never attach to two burn records.
CREATE UNIQUE INDEX IF NOT EXISTS "burn_requests_payout_reference_uq"
	ON "burn_requests" USING btree ("payout_reference");
