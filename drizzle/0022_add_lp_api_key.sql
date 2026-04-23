-- Add API key hash column to lp_accounts for MM API authentication
ALTER TABLE lp_accounts ADD COLUMN IF NOT EXISTS api_key_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS lp_accounts_api_key_hash_uq ON lp_accounts (api_key_hash) WHERE api_key_hash IS NOT NULL;
