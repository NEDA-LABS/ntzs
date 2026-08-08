-- 0082: register entry for the approved per-transaction limit not being
-- enforced on the user portal's own withdrawal path.
--
-- Same operating pattern as 0070–0079: the operator applies SQL by hand in
-- Neon, the exact prose is reviewed in the pull request, and ON CONFLICT (ref)
-- keeps re-runs harmless.
--
-- WHAT HAPPENED. The Bank's Testing Parameter 3 caps a single transaction at
-- TZS 1,000,000. That cap was enforced on the partner API, the merchant
-- collection path and the ramp routes, and a test asserted as much — but the
-- test only inspected files under app/api, so the user portal's own server
-- actions were never examined. The portal's deposit and withdrawal actions,
-- and the pay-link action, created participant deposits and redemptions with
-- no reference to the cap at all. Nothing failed, because nothing was looking.
--
-- Severity sev2 under docs/bot/incident-management.md §3. Not sev3: this is not
-- an evidence gap around a working control, it is a regulatory control that was
-- believed to be in place on every money path and was absent from three of
-- them, in production, on a customer-facing path. Not sev1: no customer lost
-- funds and the service was never unavailable.
--
-- Category 'compliance'. The defect is a control required by the sandbox
-- authorisation not operating; the money-handling consequence did not
-- materialise because a second control caught every affected request.
--
-- WHY funds_lost_tzs IS 0 AND NOT NULL. Section 4 of the incident policy says a
-- loss figure is never defaulted to zero — it is left empty until established.
-- Here it IS established, and that is the difference. Three participant
-- withdrawal requests above the cap were made in the period (TZS 1,509,046 on
-- 25 June, 1,006,533 on 26 June and 1,107,036 on 28 June). Every one of them
-- was routed to the dual-authorisation queue by the Safe approval threshold,
-- which sits at the same TZS 1,000,000 figure, and every one of them remains in
-- 'requires_second_approval' with no burn transaction and no payout. No nTZS
-- was burned and no shilling left the reserve on any of them. The figure is
-- zero because the ledger says so, not because nothing was found.
--
-- customers_affected is 3 — the participants whose requests were held. They
-- were not harmed; they were stopped, which is what should have happened,
-- though by the wrong control.
--
-- funds_at_risk_tzs is the sum of the three held requests: 1,509,046 +
-- 1,107,036 + 1,006,533 = 3,622,615. This is the value that would have moved
-- above the approved limit had the second control not held it.
--
-- STATUS 'resolved'. The three participant-facing paths now call
-- enforceSandboxLimits() before writing anything, and the guard test was
-- rewritten to walk every source file that inserts into deposit_requests or
-- burn_requests rather than API routes alone. A writer that neither enforces
-- nor is explicitly classified as platform float now fails the build.

INSERT INTO "incidents" (
  "ref", "title", "severity", "category", "status",
  "occurred_at", "detected_at", "resolved_at", "detected_by",
  "what_happened", "customer_impact", "customers_affected",
  "funds_at_risk_tzs", "funds_lost_tzs",
  "root_cause", "resolution", "control_added", "evidence_ref"
) VALUES (
  'INC-2026-06-001',
  'Approved per-transaction limit not enforced on the user portal withdrawal and deposit paths',
  'sev2',
  'compliance',
  'resolved',
  '2026-06-25 23:47:00+03',
  '2026-08-08 11:00:00+03',
  '2026-08-08 12:00:00+03',
  'internal_review',
  'The sandbox per-transaction limit of TZS 1,000,000 was enforced on the partner API, on merchant collections and on the ramp routes, but not on the user portal''s own server actions. The portal''s deposit action, its withdrawal action and the pay-link action each created a participant deposit or redemption without consulting the limit. The automated test intended to guarantee that every money path enforces the approved parameters inspected only files under the API route directory, so the portal''s server actions were outside everything that was checking. The defect was found while investigating why the first generated periodic return reported a transaction above the approved limit, and it had been live since the portal''s withdrawal path was built.',
  'Three participants submitted withdrawal requests above the approved per-transaction limit during the period: TZS 1,509,046 on 25 June 2026, TZS 1,006,533 on 26 June 2026 and TZS 1,107,036 on 28 June 2026. None of them executed. Each was routed to the dual-authorisation queue by the platform''s own high-value approval threshold, which is set at the same TZS 1,000,000 figure, and each remains held pending a second authorisation with no burn transaction recorded and no payout dispatched. No nTZS was burned, no shilling left the reserve, and no customer lost funds or was charged. The customers concerned experienced a delayed withdrawal, which is the outcome the approved limit was intended to produce, reached by a different control than the one that should have produced it.',
  3,
  3622615,
  0,
  'A regulatory control was implemented at the boundaries that were being reviewed rather than at the point where the money is written. Deposit and redemption rows are created in seven places across the codebase; the caps were applied at the four that are API routes, and the test that was supposed to guarantee coverage enumerated API routes only, so the three server actions were invisible both to the enforcement and to the check on the enforcement. The narrower failure — a test whose scope was the same as the implementation''s — is why nothing raised its hand for as long as it did.',
  'The three participant-facing paths — the portal''s deposit action, the portal''s withdrawal action and the pay-link action — now call the single enforcement chokepoint before any row is written, counted against the participant who ends up holding the tokens. For a pay link that is the recipient, since the payer funds the collection from their own mobile money and never holds nTZS. A refused request now leaves a sandbox limit event, so a limit binding on this path becomes evidence in the periodic return as it already does elsewhere.',
  'The guard test now walks every source file that inserts into deposit_requests or burn_requests, not the API route directory alone. Each writer must either call the enforcement chokepoint or appear in an explicit list of platform-float paths with a stated reason that no participant holds the balance, and a stale entry in that list fails the test as well. Adding a new writer of either table without doing one or the other fails the build.',
  'PR #259'
) ON CONFLICT ("ref") DO NOTHING;
