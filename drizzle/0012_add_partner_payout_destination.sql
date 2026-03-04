ALTER TABLE partners ADD COLUMN IF NOT EXISTS payout_phone text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS payout_type text DEFAULT 'mobile';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS payout_bank_account text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS payout_bank_name text;
