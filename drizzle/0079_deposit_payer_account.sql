-- Payer bank account on a bank-transfer deposit intent.
--
-- TIPS credits reach our settlement statement WITHOUT the payer's narration
-- (verified 6 Aug 2026: a transfer carrying reference NTZGPXNZ6 arrived as
-- "SB0806MN8GZ - VICTOR AMOS MUHAGACHI - CRDBBANK (0152768903600) - SP TIPS
-- Bank2SP New"). The reference token therefore cannot be the identity on its
-- own. The payer's own account number DOES survive, so the intent records the
-- account the payer will send from, and matching uses account + exact amount.
ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS payer_account_number varchar(34);

COMMENT ON COLUMN deposit_requests.payer_account_number IS
  'Bank account the payer will send from (bank_transfer intents). Digits only; matched against the account Selcom exposes in the statement narrative.';
