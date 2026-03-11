-- Migration 0017: Add minted_at timestamp to deposit_requests
ALTER TABLE "deposit_requests" ADD COLUMN "minted_at" timestamptz;
