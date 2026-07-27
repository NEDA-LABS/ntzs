-- 0067: partner-scoped Biashara — let a second consumer (e.g. a bank's app)
-- use the merchant API without being able to see the first-party book.
--
-- ── The isolation rule ──────────────────────────────────────────────────────
-- partner_id IS NULL  → first-party merchant (NEDApay / our own portal).
--                       This is EVERY existing row, and stays the default.
-- partner_id = <uuid> → owned by that partner; only their API key can see it.
--
-- A partner key may only ever read rows matching its own id, so NULL rows are
-- invisible to every partner — no backfill, no relabelling, and NULL fails
-- safe. NEDApay keeps using the x-service-key door, whose behaviour is
-- byte-for-byte unchanged.
--
-- ── Why the email index is split ────────────────────────────────────────────
-- email is the merchant-portal login identity, so it must stay unique among
-- first-party merchants. It does NOT need to be unique across tenants: the
-- same person may be a merchant on two platforms. The partial index on
-- (partner_id IS NULL) enforces exactly what the old global index enforced for
-- every row that exists today; the second index gives per-partner uniqueness
-- for new rows.
--
-- handle is deliberately NOT split: it resolves public payment URLs
-- (/pay/:alias) with no tenant context, so it must stay globally unique or
-- money could route to the wrong merchant. Collisions are resolved by
-- auto-suffixing at activation instead.

ALTER TABLE "merchant_accounts" ADD COLUMN IF NOT EXISTS "partner_id" uuid
  REFERENCES "partners"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "merchant_accounts_partner_id_idx"
  ON "merchant_accounts" ("partner_id");

DROP INDEX IF EXISTS "merchant_accounts_email_uq";

CREATE UNIQUE INDEX IF NOT EXISTS "merchant_accounts_email_first_party_uq"
  ON "merchant_accounts" ("email") WHERE "partner_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "merchant_accounts_email_partner_uq"
  ON "merchant_accounts" ("partner_id", "email") WHERE "partner_id" IS NOT NULL;
