-- A statement for an account the provider has FROZEN.
--
-- The staleness clock on a carried-forward balance exists for one reason:
-- money can move at the provider without us seeing it, so the older a figure
-- is, the less it means. When the provider has suspended the account — no
-- transactions, no API, no payment pages — that premise does not hold. The
-- balance is static because the custodian has made it static, and they said so
-- in writing.
--
-- So a statement marked frozen ages on a longer clock
-- (ATTESTATION_FROZEN_STATEMENT_MAX_DAYS, default 30) rather than the ordinary
-- one. It still EXPIRES, for the reason the flag can go wrong: a suspension can
-- be lifted without anyone telling us, and from that moment the balance can
-- move again while we are still quoting a month-old figure.
--
-- frozen_evidence records what the claim rests on — the suspension notice, a
-- ticket, an email — because "the provider says it cannot move" is only worth
-- anything if we can show who said it and when.
ALTER TABLE reserve_statements ADD COLUMN IF NOT EXISTS frozen boolean NOT NULL DEFAULT false;
ALTER TABLE reserve_statements ADD COLUMN IF NOT EXISTS frozen_evidence text;
