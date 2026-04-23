-- Support multi-token transfers (nTZS + USDC) on /api/v1/transfers
CREATE TYPE "transfer_token" AS ENUM ('ntzs', 'usdc');
ALTER TABLE "transfers" ADD COLUMN "token" "transfer_token" NOT NULL DEFAULT 'ntzs';
