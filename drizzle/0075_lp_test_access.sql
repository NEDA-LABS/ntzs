-- Time-boxed sandbox test access for SimpleFX LP/bank accounts.
-- While test_access_until is in the future the account may use the portal
-- without full KYC/KYB; kyb_status stays truthful and the portal auto-reverts
-- to onboarding when the window lapses. Granted/revoked from backstage.
ALTER TABLE lp_accounts ADD COLUMN IF NOT EXISTS test_access_until timestamptz;
ALTER TABLE lp_accounts ADD COLUMN IF NOT EXISTS test_access_note text;
