-- ── 0037: link biashara & enterprise to NEDApay user identities ─────────────
--
-- Three nullable, non-breaking additions:
--
--   users.product_access          — which NEDApay product features a user has
--                                   unlocked ('consumer', 'merchant', 'enterprise')
--   merchant_accounts.user_id     — the NEDApay users.id that owns this merchant
--   enterprise_accounts.linked_admin_user_id
--                                 — the NEDApay users.id who applied for / manages
--                                   this enterprise org
--
-- All columns are nullable and have safe defaults so existing rows are
-- unaffected. Backfill happens at the application layer as users migrate
-- through NEDApay onboarding.

-- ── 1. users: product access ─────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS product_access text[] NOT NULL DEFAULT ARRAY['consumer']::text[];

CREATE INDEX IF NOT EXISTS users_product_access_idx ON users USING GIN (product_access);

-- ── 2. merchant_accounts: NEDApay user link ───────────────────────────────────

ALTER TABLE merchant_accounts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS merchant_accounts_user_id_idx ON merchant_accounts(user_id);

-- ── 3. enterprise_accounts: NEDApay admin user link ──────────────────────────

ALTER TABLE enterprise_accounts
  ADD COLUMN IF NOT EXISTS linked_admin_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS enterprise_accounts_linked_admin_user_id_idx
  ON enterprise_accounts(linked_admin_user_id);
