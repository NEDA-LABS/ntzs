-- 0069: evidence that the BoT Testing Parameters actually bind.
--
-- Until now the caps were enforced (23 call sites return a limit error) but
-- never RECORDED. So if Parameter #3/#4/#5 blocked a transaction, nothing in
-- the system remembered it — and a periodic return to the Bank could assert
-- compliance but not evidence it.
--
-- A supervisor's question is not "did you set a limit?" but "show me it
-- working." This table is that answer: one row per blocked attempt, queryable
-- by parameter and period, so the milestone report can state
--   "Parameter #4 was enforced on N attempts and blocked M of them"
-- and produce the rows behind it.
--
-- Evidence only. Nothing reads this table to make a decision, so a write
-- failure can never affect a money path — the recorder is fail-soft.

CREATE TABLE IF NOT EXISTS "sandbox_limit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  -- BoT parameter: 'per_txn_cap' (#3) | 'daily_user_cap' (#4) | 'monthly_user_cap' (#5)
  "code" text NOT NULL,
  -- The participant the limit was counted against.
  "subject_kind" text NOT NULL,        -- 'user' | 'sub_wallet'
  "subject_id" uuid,
  "partner_id" uuid,
  -- What was attempted.
  "endpoint" text,
  "stage" text,                        -- 'quote' | 'execute'
  "requested_tzs" bigint NOT NULL,
  "limit_tzs" bigint NOT NULL,
  "used_in_period_tzs" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Serves the report queries: by parameter over a period, and by participant.
CREATE INDEX IF NOT EXISTS "sandbox_limit_events_code_occurred_idx"
  ON "sandbox_limit_events" ("code", "occurred_at");
CREATE INDEX IF NOT EXISTS "sandbox_limit_events_subject_idx"
  ON "sandbox_limit_events" ("subject_kind", "subject_id");
CREATE INDEX IF NOT EXISTS "sandbox_limit_events_occurred_idx"
  ON "sandbox_limit_events" ("occurred_at");
