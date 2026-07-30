-- 0071: register entry for the 30 July LUKU bill-payment incident.
--
-- Recorded as a migration for the same reason the 0070 backfill was: the
-- operator applies SQL by hand in Neon, and the exact prose is reviewed in the
-- pull request before it becomes part of the record. ON CONFLICT (ref) keeps
-- re-runs harmless.
--
-- Figures per the operator's correction of 30 Jul: TWO customers, each charged
-- once (1,047 TZS for a 1,000 TZS LUKU purchase incl. app fee). No duplicate
-- charge was realised — the retry-double-charge exposure was demonstrated by
-- the failure UX and closed the same day, which is exactly the distinction the
-- narrative must keep. Tokens were delivered manually; funds lost is a
-- confirmed zero, not an assumption.

INSERT INTO "incidents" (
  "ref", "title", "severity", "category", "status",
  "occurred_at", "detected_at", "resolved_at", "detected_by",
  "what_happened", "customer_impact", "customers_affected",
  "funds_at_risk_tzs", "funds_lost_tzs",
  "root_cause", "resolution", "control_added", "evidence_ref"
) VALUES
('INC-2026-07-011',
 'LUKU bill payments succeeded but reported failure, and prepaid tokens were not delivered',
 'sev2', 'money', 'resolved',
 '2026-07-30', '2026-07-30', '2026-07-30', 'customer',
 'Two customers paying LUKU electricity bills (1,000 TZS purchases, meter 24219217817) through a partner application were each shown "Payment failed" although their payments had succeeded at the payment service provider. The payment request could exceed the platform''s own execution time limit after the money had already moved, so the application received a network failure instead of a result (Selcom references 1820904138 and 1820982008). Both purchases issued prepaid tokens, but the tokens were delivered only to our operator SMS channel — the settlement reader used wrong field names for the provider''s payload, so the token was never captured or returned to the application. At least one customer retried after the failure screen; no request had duplicate protection, so a retry would have charged again. Separately, the meter-owner name check failed on every attempt — biller validation requires a purchase amount the lookup request did not carry — so the application showed "Unverified destination" for a meter the provider could name.',
 'Two customers, each charged 1,047 TZS (1,000 TZS purchase plus fees) for electricity they initially could not use: both were shown a failure screen and neither received their prepaid token in the application. Both tokens were valid at the utility and were delivered to the customers manually. The duplicate-charge exposure was real but not realised — each customer was charged exactly once.',
 2, 2094, 0,
 'Four defects compounding: (1) the execute route scheduled ~21 seconds of deliberate settlement polling inside a 60-second execution limit that also contained on-chain work, so it could exceed its own budget after money moved; (2) no duplicate protection existed for a user-initiated retry — the provider''s idempotency keys on our per-attempt transaction id, which is regenerated per request; (3) the settlement payload was read with camelCase field names against a snake_case body, so tokens, receipts and actual charges were silently never recorded; (4) the biller name lookup omitted the purchase amount that biller validation requires, and its 8-second timeout was tuned for wallet lookups, not utility validation.',
 'Tokens delivered to both customers. Fixes shipped to production the same day: the settlement poll now yields to the reconciliation cron rather than overrun the route; an identical payment from the same wallet to the same destination for the same amount within five minutes returns the original transaction (with its token) instead of paying again, with an explicit override for deliberate repeat purchases; the provider''s full settlement payload is captured on every spend and the token, units and receipts are returned to the partner and delivered by webhook; biller lookups carry the purchase amount with a 25-second budget, and every route making them declares an execution limit that outlives its own work. The meter-owner name was verified resolving end-to-end after the fixes.',
 'A pre-burn duplicate guard on the execute path; a transaction status endpoint so clients resolve uncertainty by reading instead of retrying; a single tolerant reader for provider settlement payloads that preserves the raw answer, so the next misnamed field is visible in the record rather than silently absent; automated tests pinning the duplicate window, the poll deadline, the lookup request shape, and the coupling between lookup timeouts and route execution limits.',
 'PRs #194, #195, #196; Selcom refs 1820904138, 1820982008; admin lookup probes of 30 Jul 2026')
ON CONFLICT ("ref") DO NOTHING;
