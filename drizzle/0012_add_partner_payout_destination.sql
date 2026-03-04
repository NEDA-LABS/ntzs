ALTER TABLE partners ADD COLUMN IF NOT EXISTS payout_phone text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS payout_type text DEFAULT 'mobile';
