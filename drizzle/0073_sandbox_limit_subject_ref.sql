-- 0073: sandbox_limit_events.subject_ref — evidence for limits counted
-- against subjects that are not rows in our database.
--
-- Ramp period caps count per Tanzanian-side counterparty (a merchant till, a
-- bill account, a mobile wallet). Those subjects have canonical refs like
-- 'lipa:61115582' or 'phone:0744277496' — not uuids — so the existing uuid
-- subject_id column cannot record them. Without this column, a ramp block
-- would be recorded with no subject at all, which is half-evidence.
--
-- subject_ref is now written on EVERY block (for users/sub-wallets it
-- duplicates subject_id as text), so one column always answers "against whom
-- did the limit bind".

ALTER TABLE "sandbox_limit_events" ADD COLUMN IF NOT EXISTS "subject_ref" text;

CREATE INDEX IF NOT EXISTS "sandbox_limit_events_subject_ref_idx"
  ON "sandbox_limit_events" ("subject_ref");
