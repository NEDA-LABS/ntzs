-- 0070: the incident register.
--
-- Every regulated payments operator is asked the same three questions after a
-- bad day: what happened, who was affected, and what stops it happening again.
-- Answering them from memory, a Slack thread and a git log is not an answer —
-- it is a reconstruction, and a supervisor can tell the difference.
--
-- This table is the curated record. It is deliberately NOT an event feed:
-- `activity` already streams everything the system does. An incident is a
-- human judgement that something went wrong enough to be worth writing down,
-- so entries are written by a person, in prose, and each one has to name the
-- control that was added. An incident with no control added is an incident
-- that will recur.
--
-- Three properties that make it credible rather than decorative:
--
--   1. NOTHING IS DELETABLE. The Backstage page can update an entry and every
--      update writes an audit log; there is no delete path. A register you can
--      quietly empty is worth nothing to the person reading it.
--
--   2. FUNDS LOST IS AN EXPLICIT NUMBER, INCLUDING ZERO. "No customer lost
--      money" is the single most important claim we make to the Bank, and it
--      should be the sum of a column, not an assurance. NULL means unknown and
--      is a prompt to go and find out — it is not the same as zero.
--
--   3. DISCLOSURE IS A DECISION, NOT A DEFAULT. `reported_to_bot` starts false
--      on every row, including the ones seeded below. What goes into a
--      periodic return is a judgement for the people who sign it. The register
--      is complete internally; the return is a subset with a name against it.

CREATE TABLE IF NOT EXISTS "incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human key, e.g. INC-2026-07-006. Stable across systems, and what makes the
  -- seeds below idempotent.
  "ref" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  -- sev1 (funds lost or service down) | sev2 (money/authorisation/compliance
  -- defect reached production) | sev3 (control or evidence gap, no customer
  -- impact) | sev4 (internal-only degradation)
  "severity" text NOT NULL,
  -- money | availability | compliance | security | data
  "category" text NOT NULL,
  -- open | mitigated | resolved
  "status" text NOT NULL DEFAULT 'open',

  -- Start of the exposure window where it is known. For a latent defect whose
  -- introduction cannot be dated honestly, this is the detection date and
  -- `what_happened` says so — an invented start date is worse than a vague one.
  "occurred_at" timestamptz NOT NULL,
  "detected_at" timestamptz,
  "resolved_at" timestamptz,
  -- monitoring | log_review | customer | partner | internal_review | regulator
  -- Worth tracking on its own: a register where nothing is ever found by
  -- monitoring is telling you the monitoring is not working.
  "detected_by" text,

  "what_happened" text NOT NULL,
  "customer_impact" text NOT NULL,
  "customers_affected" integer,
  "funds_at_risk_tzs" bigint,
  -- Zero is a claim. NULL is a question that has not been answered yet.
  "funds_lost_tzs" bigint,

  "root_cause" text,
  "resolution" text,
  -- What now makes recurrence structurally harder — a test, a gate, a chokepoint.
  "control_added" text,
  -- Where to verify it: PR number, commit, log query.
  "evidence_ref" text,

  "reported_to_bot" boolean NOT NULL DEFAULT false,
  "reported_to_bot_at" timestamptz,
  "bot_report_ref" text,

  "created_by_user_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "incidents_occurred_idx" ON "incidents" ("occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "incidents_status_idx" ON "incidents" ("status");
CREATE INDEX IF NOT EXISTS "incidents_severity_idx" ON "incidents" ("severity");
CREATE INDEX IF NOT EXISTS "incidents_reported_idx" ON "incidents" ("reported_to_bot");

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill.
--
-- A register created today that starts today is not evidence of anything. These
-- rows are reconstructed from git history, production logs and review notes, so
-- the record starts where the platform started rather than where the table did.
--
-- Included: defects and control gaps that were LIVE IN PRODUCTION. Excluded:
-- everything caught in review before it merged — that is ordinary development,
-- and padding the register with near-misses would make it flattering instead of
-- useful.
--
-- Earlier incidents that are known but not yet reconstructed to this standard
-- (notably the twelve June deposits that were paid but never minted) are not
-- seeded here. An entry with invented detail is worse than a missing one; they
-- go in by hand once the underlying records have been read.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "incidents" (
  "ref", "title", "severity", "category", "status",
  "occurred_at", "detected_at", "resolved_at", "detected_by",
  "what_happened", "customer_impact", "customers_affected",
  "funds_at_risk_tzs", "funds_lost_tzs",
  "root_cause", "resolution", "control_added", "evidence_ref"
) VALUES

('INC-2026-07-001',
 'Mint retry and treasury re-mint were not idempotent',
 'sev2', 'money', 'resolved',
 '2026-07-04', '2026-07-04', '2026-07-04', 'internal_review',
 'An internal security assessment of the minting and payout paths found two ways the same value could be issued twice: a broadcast mint could be marked failed and retried while the original transaction was still pending, and a treasury re-mint after a failed payout was not keyed to the payout reference. Both were latent — present in production code, with no confirmed occurrence. The exposure window predates reliable dating, so occurred_at is the date of identification.',
 'None confirmed. Neither defect is known to have fired; the risk was unbacked nTZS entering supply, which is a peg risk rather than a direct customer loss.',
 0, NULL, 0,
 'Retry logic treated "no receipt yet" as "failed" rather than "unknown", and the re-mint had no idempotency key tying it to the payout it was reversing.',
 'A broadcast mint is never marked failed; retries are guarded. Treasury re-mint is idempotent per payout reference.',
 'Regression tests for both paths, and the rule that an ambiguous PSP or chain answer must never be scored as a definite failure — the same rule later prevented a double-pay on the AzamPay duplicate response.',
 'commits 3e75b10, d02dd31 (assessment findings C1, C2)'),

('INC-2026-07-002',
 'Signup pause locked out existing partner users',
 'sev2', 'availability', 'resolved',
 '2026-07-08', '2026-07-08', '2026-07-08', 'customer',
 'New wallet creation was paused to satisfy BoT Testing Parameter 8 until KYC went live. The gate was applied to the whole partner surface rather than only to new wallet creation, so partner users who already had wallets were locked out of the platform.',
 'Existing partner users could not transact for the duration of the window. No funds were affected — the gate refused requests rather than mis-executing them.',
 NULL, NULL, 0,
 'A control intended for one action (create wallet) was placed at a boundary that covered many (all partner requests). The blast radius of the gate was never stated when it was written.',
 'Hotfixed the same day: the pause applies to wallet creation only.',
 'New gates state which actions they cover, and the pause has a test asserting an existing user is unaffected.',
 'PR #105'),

('INC-2026-07-003',
 'Selcom Identity contract mismatch broke production KYC',
 'sev2', 'availability', 'resolved',
 '2026-07-13', '2026-07-13', '2026-07-13', 'log_review',
 'Selcom Identity verification calls were rejected because our request sent the wrong field pair. The live contract requires nida_number together with mobile_number; we were not sending that pair. Since KYC is a structural prerequisite for a wallet, verification failing meant onboarding stopped.',
 'New users could not complete identity verification and therefore could not be issued a wallet, until the fix shipped the same day. No funds were affected.',
 NULL, NULL, 0,
 'The adapter was built against documentation rather than a verified live response, and the mismatch only surfaced against the production endpoint.',
 'Adopted the live pair contract and widened the response parser.',
 'PSP adapters are now verified against a live call before they gate a user-facing path, and parser changes ship with the real response shape captured in a test.',
 'PR #116 (see also #108, #109)'),

('INC-2026-07-004',
 'Backstage activity tab returned 500',
 'sev4', 'availability', 'resolved',
 '2026-07-17', '2026-07-17', '2026-07-17', 'internal_review',
 'The internal Activity & Logs page failed with a 500. One source in the unified feed returned timestamps as strings, and the shared formatter assumed Date objects, so a single bad source took down the whole page.',
 'None. Internal operations tooling only; no customer-facing surface and no money path.',
 0, NULL, 0,
 'A page that aggregates many sources had no per-source isolation, so any one source could fail the whole render.',
 'Per-source guards with an error banner, then the underlying timestamp coercion fix.',
 'Aggregating pages fail per-source rather than wholesale, and degrade visibly instead of blank-screening — the same pattern the incident register page itself uses.',
 'PRs #130, #131'),

('INC-2026-07-005',
 'An incomplete reserve attestation was emailed to the Bank',
 'sev2', 'compliance', 'resolved',
 '2026-07-23', '2026-07-23', '2026-07-23', 'internal_review',
 'The attestation mailer sent the Bank of Tanzania a reserve reading assembled while one or more reserve pots could not be read. Plumbing alerts intended for the internal team were included in the regulator-facing email, so the Bank received a degraded reading presented as an attestation.',
 'No customer impact and no funds affected. The recipient was the regulator: the artefact understated verified reserves and carried internal diagnostic language that did not belong in a supervisory communication.',
 0, NULL, 0,
 'The attestation had one output path for two audiences. Degraded readings were tolerated by the sender rather than refused, so an incomplete state could reach the most consequential recipient we have.',
 'Regulator email returned to the classic format; the annex and plumbing alerts stay internal until explicitly promoted; a degraded reading is never attested at all.',
 'A reading that cannot be fully verified is refused rather than sent. Internal and regulator-facing outputs are separate paths, so the internal one cannot leak into the external one by default.',
 'PRs #148, #149'),

('INC-2026-07-006',
 'Every partner API call returned 500 after the test-mode deploy',
 'sev2', 'availability', 'resolved',
 '2026-07-27', '2026-07-27', '2026-07-27', 'log_review',
 'Test mode added columns to the partners table. Because migrations are applied by hand, the code was written to tolerate the columns being absent until the migration ran. That tolerance never fired: partner authentication reads the partners row on every request, so every partner API call failed with a 500 between the deploy and the fix.',
 'Partner API traffic failed for the window. Requests were rejected rather than mis-executed, so no transaction was recorded incorrectly and no funds were affected. Partners saw errors, not wrong balances.',
 NULL, NULL, 0,
 'The deploy-order fallback matched on a bare Postgres driver error. Drizzle wraps driver errors in DrizzleQueryError, whose message is the SQL and whose real error is on .cause — so the check never matched. The safety net had been written but never tested against an error a real driver produces.',
 'lib/db-errors.ts walks the full cause chain and matches both SQLSTATE codes and message text.',
 'A fallback for a condition we cannot reproduce locally is now tested against the actual wrapper shape, not the shape assumed when writing it. This is the general lesson from the incident: an untested safety net is a comment.',
 'PR #181'),

('INC-2026-07-007',
 'Biashara shipped with its entitlement and KYB gates not binding',
 'sev2', 'security', 'resolved',
 '2026-07-27', '2026-07-27', '2026-07-27', 'internal_review',
 'Partner-scoping the Biashara merchant product introduced two authorisation defects in the same deploy. First, capability resolution treated an empty capability list as "everything", so adding biashara to the enum silently granted a live merchant money product to every existing partner that had never been given an explicit list. Second, the biashara capability was marked as KYB-required in its metadata, but nothing read that flag — the requirement was documentation, not a gate.',
 'None observed. The window was a few hours on the same day and no partner without an explicit grant called a Biashara endpoint. Had one done so, they could have activated merchants and moved merchant funds without approved KYB.',
 0, NULL, 0,
 'A permissive default that was safe when the capability set was uniform became unsafe the moment a capability existed that must not be universal. And a capability requirement expressed as data was never connected to a check.',
 'Capabilities that must never be granted implicitly are declared opt-in, and the KYB gate mirrors the one already enforced on the ramp capability.',
 'Opt-in capabilities are an explicit list rather than a convention, and a coverage test fails CI if a route with a KYB-required capability does not enforce it. Adding a capability to the enum can no longer widen anyone''s access by itself.',
 'PR #184 (introduced by #183)'),

('INC-2026-07-008',
 'A failed payout would have reverted nTZS to the wrong wallet',
 'sev2', 'money', 'resolved',
 '2026-07-28', '2026-07-28', '2026-07-28', 'internal_review',
 'When a mobile-money payout fails, the burned nTZS is re-minted so the customer is made whole. Both payout webhooks re-minted to the wallet address looked up from the burn''s wallet id, rather than to the address the burn actually debited. For ramp settlement burns the two differ, so a failed payout would have credited the wrong wallet — leaving the funding source short and the treasury long by the same amount. Latent: found in a review of the queued payout paths, with no confirmed occurrence.',
 'None confirmed. No failed payout on an affected path is known to have occurred. Total supply would have stayed correct, so the peg was never at risk; the error was in who held the balance.',
 0, NULL, 0,
 'The revert resolved the destination from a relationship (wallet id) instead of from the fact it was reversing (the address debited). The two are equal in the common case, which is why it survived review.',
 'The revert credits the address the burn debited, falling back to the user wallet only when that is absent.',
 'A reversal now derives its destination from the original movement rather than re-deriving it, and the queued payout paths carry tests for the case where the funding source is not the user wallet.',
 'PR #189'),

('INC-2026-07-009',
 'BoT testing parameters were enforced but never recorded',
 'sev3', 'compliance', 'resolved',
 '2026-07-28', '2026-07-28', '2026-07-28', 'internal_review',
 'The approved testing parameters were enforced correctly at every call site, but a block left no trace anywhere in the system. The platform could state that the caps were in place without being able to show a single instance of one binding.',
 'None. Transactions were correctly refused; only the evidence was missing.',
 0, NULL, 0,
 'Enforcement and evidence were separate concerns and only the first was built. Evidence of a control working cannot be reconstructed after the fact — the events simply were not written down.',
 'A sandbox_limit_events table, and a single enforceSandboxLimits chokepoint that checks every applicable parameter and records any block in the same call.',
 'A coverage test fails CI if any route rejects on a testing parameter without going through the chokepoint, so enforcement and evidence cannot drift apart again. The recorder is fail-soft and logs loudly, so a lost record is visible rather than silent.',
 'PR #190'),

('INC-2026-07-010',
 'Merchant collections were not counted toward the daily and 30-day participant caps',
 'sev2', 'compliance', 'resolved',
 '2026-07-28', '2026-07-28', '2026-07-28', 'internal_review',
 'A merchant collection mints nTZS into the merchant''s wallet, which makes the merchant a participant holding the token. The collection route enforced only the per-transaction cap; the period-limit checker was imported but never called. A merchant could therefore collect past both the daily and the 30-day participant allowance. The gap dated from the launch of the merchant product.',
 'No customer lost funds and no transaction was mis-executed. The exposure is regulatory: an approved testing parameter was under-enforced on a live money path.',
 NULL, NULL, 0,
 'The route was reasoned about from the payer''s side — the payer pays from their own mobile money and never holds nTZS, so it was concluded there was no participant to count against. The payer was never the participant. The merchant is, because that is where the minted tokens land. The conclusion was written into a test exemption, which then made it look considered.',
 'The route enforces all applicable parameters through the shared chokepoint with the merchant as the subject, so blocks are both applied and recorded.',
 'The exemption list is empty and its doc comment records the reasoning error, so the next exemption is written by checking where the tokens land rather than who initiates the payment. Partner documentation now states the limits and the headroom fields so integrations can show a merchant their remaining allowance.',
 'PR #191')

ON CONFLICT ("ref") DO NOTHING;
