-- Multi-PSP plumbing (plan Phase 0a): 'selcom' provider + payout stamping.
-- Hand-authored per the 0050+ convention (journal stale at idx 49). Idempotent.
--
-- ADD VALUE runs as its own statement: a new enum value cannot be used in the
-- same transaction that created it (the backfill below only uses the
-- pre-existing 'snippe' value, but keep the separation regardless).

ALTER TYPE "psp_provider" ADD VALUE IF NOT EXISTS 'selcom';
--> statement-breakpoint

-- Which PSP a payout was routed to, stamped at request-creation time.
-- Executors/reconcilers dispatch by this stamp, never by the active routing.
ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "payout_provider" "psp_provider";
--> statement-breakpoint

-- PSP fee baked into the gross-up at request time; read, never recomputed.
ALTER TABLE "burn_requests" ADD COLUMN IF NOT EXISTS "psp_fee_tzs" bigint;
--> statement-breakpoint

-- Backfill: Snippe was the only historical payout rail (flat 1500 TZS fee).
-- Code still treats NULL as legacy-Snippe defensively.
UPDATE "burn_requests" SET "payout_provider" = 'snippe'
	WHERE "payout_provider" IS NULL AND "payout_reference" IS NOT NULL;
--> statement-breakpoint
UPDATE "burn_requests" SET "psp_fee_tzs" = 1500
	WHERE "psp_fee_tzs" IS NULL AND "payout_reference" IS NOT NULL;
