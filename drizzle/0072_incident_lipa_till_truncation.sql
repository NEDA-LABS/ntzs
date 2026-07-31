-- 0072: register entry for the 30–31 July merchant Lipa payout failures
-- (provider-side till-number truncation, plus a TIPS name-enquiry outage).
--
-- Same operating pattern as 0070/0071: the operator applies SQL by hand in
-- Neon, the exact prose is reviewed in the pull request, and ON CONFLICT (ref)
-- keeps re-runs harmless.
--
-- Status is 'mitigated', not 'resolved': the provider reported the defect
-- fixed at 13:24 EAT on 31 July, but our own verification (name probe plus a
-- small live payout to the affected 9-digit till) had not run when this was
-- written. Flip to resolved through Backstage once the re-test passes, so the
-- transition is audited with its evidence.
--
-- funds_at_risk_tzs is NULL (unknown) deliberately: each failed attempt held
-- its full amount for under a minute before automatic reversal, and the exact
-- figures live on the burn rows — fill from there rather than estimate here.
-- funds_lost_tzs is a confirmed zero: every attempt auto-reverted.

INSERT INTO "incidents" (
  "ref", "title", "severity", "category", "status",
  "occurred_at", "detected_at", "resolved_at", "detected_by",
  "what_happened", "customer_impact", "customers_affected",
  "funds_at_risk_tzs", "funds_lost_tzs",
  "root_cause", "resolution", "control_added", "evidence_ref"
) VALUES
('INC-2026-07-012',
 'Merchant Lipa payouts to tills longer than 8 digits failed at the payment service provider',
 'sev3', 'availability', 'mitigated',
 '2026-07-30', '2026-07-30', NULL, 'customer',
 'A customer paying a merchant with a 9-digit Lipa Namba (till 115045768, KIMERE RESORT) through a partner application had the payout fail at the payment service provider within seconds of dispatch, with no failure reason returned on the status surface (provider references 202607304073 on 30 July and our controlled reproduction 202607310571 on 31 July). Our dispatch requests are signed (RSA-SHA256 over every field, including the till number), and the provider''s own raw log showed "Till number 115045 does not exist" — the 9-digit till truncated to 8 digits inside the provider''s pipeline after our signature had been verified, proving the full number arrived intact. Separately and concurrently, an outage of the national instant payment switch (TIPS) on the provider''s side broke destination name enquiry across networks for part of 31 July (their error 642, "Name enquiry failed. Please try again later"), which the provider confirmed independently. The provider acknowledged the payout defect in writing ("It was an issue on our side") at 13:24 EAT on 31 July and reported it fixed.',
 'One known customer was unable to complete a merchant payment despite multiple attempts across two days. Every failed attempt automatically reversed the customer''s burned balance in under a minute and the application reported an honest failure, so no customer money was taken or stranded at any point. Exposure was broader than the one merchant: for the window, payouts to any merchant till longer than 8 digits would have failed the same way (our previously verified merchants use 8-digit tills and were unaffected).',
 1, NULL, 0,
 'Entirely provider-side, in two unrelated parts: (1) the provider''s payout pipeline truncated till numbers longer than 8 digits after verifying the request signature, then failed the payment because the truncated till does not exist; (2) a TIPS outage broke the provider''s name-enquiry service across networks. Nothing in our dispatch was at fault: the signed payload carried the full till number, which is how the truncation was established from evidence rather than argued about — the provider initially attributed the failure to us entering the wrong till.',
 'Provider fixed the truncation on their side and confirmed in writing on 31 July; the TIPS name-enquiry outage recovered the same day. Our verification of the fix (read-only name probe plus a small live payout to the affected till through the admin test harness) is the step gating this entry''s move to resolved. Customer-protective behaviour worked as designed throughout: automatic reversal of every failed payout and an honest failure screen.',
 'Failure evidence is now captured on every failed payout — the provider''s verdict and reason are persisted on the transaction rather than discarded (PRs #198, #199), which is what produced a provable claim inside a day. The admin lookup probe and spend-test harness reproduce a customer report in minutes without code changes, and signature-covered payloads make "what we actually sent" demonstrable to the provider, closing the "you entered it wrong" argument with evidence.',
 'PRs #198, #199; provider transIds 202607304073, 202607310571; provider raw log "Till number 115045 does not exist" against signed payNumber 115045768; provider written confirmation of 31 Jul 2026 13:24 EAT; provider error 642 name-enquiry failures of 31 Jul 2026')
ON CONFLICT ("ref") DO NOTHING;
