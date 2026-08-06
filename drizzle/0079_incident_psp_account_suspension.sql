-- 0079: register entry for the 6 August provider account suspension — Vodacom
-- M-Pesa collections lost, and the daily reserve attestation reported a
-- coverage collapse that had not happened.
--
-- Same operating pattern as 0070–0074: the operator applies SQL by hand in
-- Neon, the exact prose is reviewed in the pull request, and ON CONFLICT (ref)
-- keeps re-runs harmless.
--
-- Severity sev2 under docs/bot/incident-management.md §3: not sev1, because the
-- service was not unavailable — deposits on every other network, bank-transfer
-- deposits, payouts, transfers and on-chain operations all continued — but a
-- defect in regulatory compliance reached production, namely a daily reserve
-- report that stated 67.69% coverage against a true position above 100%.
--
-- Category 'compliance' rather than 'availability'. The customer-visible effect
-- is availability, but the reason this is reportable is that our own reserve
-- report was wrong, the reserve became unverifiable through its primary source,
-- and a third party has alleged unlicensed activity against a sandbox
-- participant. The availability loss is a consequence of those.
--
-- Status 'open', not 'mitigated'. The mitigations shipped the same day, but a
-- whole mobile network remains unable to deposit and the reserve is still not
-- verifiable through the provider's API. Calling that mitigated would overstate
-- it; the entry moves when the account is restored or M-Pesa collections are
-- served by another rail.
--
-- funds_lost_tzs is deliberately NULL, not 0. Under §4 of the incident policy
-- the figure is left empty and reported as unestablished until it is actually
-- established, and never defaulted to zero. No customer has been shown to have
-- lost funds and none is expected to have, but a collection in flight at the
-- moment the account was disabled cannot be ruled out until the provider's
-- statement is read. The same applies to funds_at_risk_tzs: the inaccessible
-- reserve balance is approximately 2.66m TZS by arithmetic from the day's
-- reports (total reserves at 106.2% of 6,903,064 nTZS supply, less the
-- 4,672,492 TZS read from the other two pots), but an approximation derived
-- from a rounded percentage does not belong in this column. Both are set by the
-- UPDATE recorded in the pull request once the provider's statement arrives.
--
-- customers_affected is likewise NULL: the number of customers who attempted an
-- M-Pesa deposit and could not is not known, and any figure we could give would
-- undercount it by counting only those who reached our records.
--
-- reported_to_bot stays false. Disclosure is a separate deliberate act (§5.3)
-- and is stamped when the return naming this incident is filed.

INSERT INTO "incidents" (
  "ref", "title", "severity", "category", "status",
  "occurred_at", "detected_at", "resolved_at", "detected_by",
  "what_happened", "customer_impact", "customers_affected",
  "funds_at_risk_tzs", "funds_lost_tzs",
  "root_cause", "resolution", "control_added", "evidence_ref"
) VALUES
('INC-2026-08-002',
 'Payment service provider suspended our account alleging unlicensed betting activity; Vodacom M-Pesa deposits lost and the daily reserve report understated coverage as 67.69%',
 'sev2', 'compliance', 'open',
 '2026-08-06 10:00:00+03', '2026-08-06 10:00:40+03', NULL, 'monitoring',
 'On 6 August 2026 Snippe, one of our payment service providers, suspended our account. Their notice gave the reason as "suspected unlicensed betting/gaming activity conducted through this account", stated that all transactions, API keys and payment pages had been disabled, and confirmed that our balance remains in the account. We do not conduct, process or facilitate betting or gaming activity of any kind; the platform is a Tanzanian Shilling-referenced stablecoin operating under the Bank of Tanzania Regulatory Sandbox, and the characterisation is rejected. The provider has not identified the transactions that prompted it. Two consequences reached production. FIRST, Vodacom M-Pesa deposits stopped. Snippe was the only rail able to collect from Vodacom M-Pesa: AzamPay''s Vodacom onboarding is incomplete, and the Selcom push-USSD collection path is implemented but not enabled. Because the credentials were invalidated rather than the requests being accepted, initiations were refused outright by the provider rather than accepted and then lost, so the failure mode was a clean refusal rather than money taken without credit. SECOND, the 10:00 EAT reserve attestation could not read the Snippe balance and dropped that component from the reserve sum entirely, computing provisional coverage of 67.69% against a true position above 100%. No attestation was sent on that reading: the run was correctly classified INCOMPLETE and the alert went to the internal operations list, not to the Bank, and no row was persisted. The platform''s own statement of its reserve position was nonetheless materially wrong from that run until the correction the same day. This is the second account action by the same provider within six days. On 1 August the same provider flagged the same account for review and refused every mobile-money disbursement (INC-2026-08-001); at that time no trigger was stated, and the register entry recorded the most likely candidate as the rapid identical-amount retry pattern our own unguarded retries produced. The reason now given identifies the provider''s concern, and supersedes that hypothesis.',
 'Vodacom M-Pesa deposits have been unavailable since the suspension took effect and remain unavailable. Customers attempting one now receive a message naming their network, stating that the cause is ours and temporary, offering another network or bank transfer, and confirming that their balance is untouched and nothing has been charged. Deposits on Airtel, Tigo/Yas and Halotel, bank-transfer deposits, all cash-out payouts, transfers, swaps and on-chain balances were unaffected throughout: payouts run on Selcom and the other collection networks are served by AzamPay. Three deposit attempts recorded this morning — one of 10,000 TZS and two of 3,000 TZS across two wallet-holders — are under review to establish whether they were refused cleanly by the invalidated credentials or predate the suspension and belong to a separate, already-corrected defect; two of the three timestamp before the first evidenced effect of the suspension. No customer has been shown to have lost funds and none is expected to have. The figure is reported as unestablished rather than zero because a collection in flight at the moment the account was disabled cannot be ruled out until the provider''s statement of the account is read.',
 NULL, NULL, NULL,
 'Four layers. (1) Single-rail dependence on the collection side. One provider''s unilateral decision removed Vodacom M-Pesa deposits entirely, because the alternates were not genuinely available — AzamPay cannot collect M-Pesa pending its own Vodacom onboarding, and the Selcom collection path, though implemented, had never been enabled. This is the same structural weakness as INC-2026-08-001 on the disbursement side, on the side that had not yet been addressed. (2) No proactive disclosure of our regulatory standing to the provider''s risk function. Our sandbox authorisation was never lodged with the provider''s compliance team, so their screening assessed an unexplained pattern of small, rapid, identical-amount mobile-money transactions on its face. (3) Reserve verifiability rested on a single API per pot with no alternative evidence path. There was no mechanism to accept a balance the custodian stated to us by other means, so losing the API meant losing the figure. (4) A defect of our own: the attestation treated an unreadable reserve pot as an absent one. Dropping the component silently converted a provider outage into an apparent 32-point coverage collapse, which is a materially false statement of the reserve position and the reason this incident is reportable rather than merely operational.',
 'Same day, and partial — the suspension itself is unresolved. The attestation now carries an unreadable pot forward rather than dropping it, in a defined order of preference: the custodian''s own statement of the balance where one exists, else our last API-verified reading. Either substitution marks the report QUALIFIED, names the source and the date the figure was true, and states that it is not verified as at today; a banner sits above the figures rather than beneath them. Both substitutions expire — seven days by default, thirty for a statement covering an account the provider has confirmed frozen and therefore incapable of movement — after which the run reverts to INCOMPLETE and a person decides. The provider''s rail can be removed from all routing without deleting credentials, so customers are no longer offered a rail certain to refuse. Snippe have been asked to state the transactions that prompted the review and to receive our Bank of Tanzania sandbox authorisation; they have agreed to provide a statement of the account balance while API access is withheld. Restoring Vodacom M-Pesa collections requires either reinstatement or enabling the Selcom push-USSD collection path, which is a decision pending.',
 'The attestation can no longer report a reserve collapse caused by a read failure: a pot that cannot be read is substituted from the best available evidence and the report is qualified, or the run refuses to attest at all — there is no path by which an unreadable pot silently becomes a missing one. Both substitutions carry a hard expiry so a stale figure cannot stand indefinitely, and the expiry is documented as a control rather than a tunable. A statement entered from a provider requires its own reference so the underlying document can be demanded, and marking an account frozen requires the evidence for that claim; both are recorded against the operator who entered them. A rail kill switch removes a provider from every routing plan without deleting credentials, and the operational trap that disabling a sole configured rail stops every network — not only the networks that rail alone could serve — is pinned by a test and documented at the point of configuration. Customers who cannot be served by any rail receive a written message rather than a raw failure. Tests pin each of these, including the incident itself: the dropped-pot arithmetic that produced 67.69% is asserted as the behaviour being prevented. PRs #241, #242, #243.',
 'Provider suspension notice, 6 August 2026, subject "[Snippe] Your Snippe Account Has Been Temporarily Suspended", reason "Suspected unlicensed betting/gaming activity conducted through this account"; internal operations alert "nTZS Attestation INCOMPLETE — 2026-08-06 — manual review required", generated 2026-08-06T07:00:40Z, recording Snippe balance read failure "invalid API key" and provisional raw coverage 67.69% against on-chain supply 6,903,064 nTZS, AzamPay 327,500 TZS and Selcom 4,344,992 TZS; PRs #241, #242, #243; related INC-2026-08-001; incident policy docs/bot/incident-management.md.')
ON CONFLICT ("ref") DO NOTHING;
