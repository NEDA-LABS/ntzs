-- Allow transfers to arbitrary wallet addresses (not just platform users)
ALTER TABLE "transfers" ALTER COLUMN "to_user_id" DROP NOT NULL;
ALTER TABLE "transfers" ADD COLUMN "to_address" text;
