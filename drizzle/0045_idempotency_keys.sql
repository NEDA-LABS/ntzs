-- Server-side idempotency for side-effectful endpoints (withdrawals).
-- A claim is inserted before the side effect; a retry carrying the same
-- (scope, idem_key) replays the stored response instead of re-executing.
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "idem_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'processing',
  "response_status" integer,
  "response_body" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_scope_key_uq" ON "idempotency_keys" ("scope", "idem_key");
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_at_idx" ON "idempotency_keys" ("created_at");
