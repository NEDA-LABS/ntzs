-- 0074: register entry for the 1 August cash-out outage — every mobile-money
-- disbursement rail refusing initiations, six burned withdrawals stranded,
-- all minted back the same day.
--
-- Same operating pattern as 0070–0072: the operator applies SQL by hand in
-- Neon, the exact prose is reviewed in the pull request, and ON CONFLICT (ref)
-- keeps re-runs harmless.
--
-- Status is 'resolved', not 'mitigated': unlike 0072 there is nothing left to
-- verify — both providers' own records confirmed zero dispatches for the day,
-- all six burns were minted back through the audited operator action, and the
-- operator confirmed the users whole. The per-row remint evidence (tx hashes)
-- lives on audit_logs under action 'burn.operator_force_reverted'.
--
-- funds_at_risk_tzs is the exact locked sum: 149,990 × 3 + 149,688 × 3 =
-- 899,034 TZS across six burns and two recipients. Locked, not lost — the
-- matching fiat never left the reserve accounts, so the reserve sat
-- over-backed by this amount for the hours the burns were stranded.
-- funds_lost_tzs is a confirmed zero.
--
-- occurred_at is exact (the first refused dispatch on the burn rows).
-- detected_at and resolved_at carry approximate times — customer report late
-- morning EAT, sixth mint back confirmed early evening EAT; the exact minutes
-- were not recorded, and the authoritative per-event timestamps are on the
-- burn rows and audit_logs. Recipient identifiers are deliberately kept off
-- this register (personal data); they are on the burn rows.

INSERT INTO "incidents" (
  "ref", "title", "severity", "category", "status",
  "occurred_at", "detected_at", "resolved_at", "detected_by",
  "what_happened", "customer_impact", "customers_affected",
  "funds_at_risk_tzs", "funds_lost_tzs",
  "root_cause", "resolution", "control_added", "evidence_ref"
) VALUES
('INC-2026-08-001',
 'All mobile-money cash-outs failed after the sole live disbursement rail suspended our account; six burned withdrawals stranded, minted back same day',
 'sev2', 'availability', 'resolved',
 '2026-08-01 09:08:00+03', '2026-08-01 11:00:00+03', '2026-08-01 17:00:00+03', 'customer',
 'From 09:08 EAT on 1 August every mobile-money cash-out initiation was refused. Snippe — at that point the only live disbursement rail, because AzamPay disbursements require a static egress IP we do not yet have and the Selcom disbursement path had never been proven live — rejected every dispatch with "your account has been flagged for review. Please contact support." Cash-out flows burn nTZS first and dispatch the payout second, so each attempt left a completed on-chain burn with no payout: six burns totalling 899,034 TZS entered the reconciliation queue across two recipients. Four of the six were a single WaaS partner treasury withdrawal retried automatically by the partner''s integration against the dead rail — every retry was a fresh burn, draining the partner''s wallet while nothing arrived; the other two were a retail user''s withdrawal and retry. Enabling the Selcom fallback initially failed as well: the adapter carried a wallet destination-code vocabulary (the VMCASHIN family) that Selcom rejected with error 651 "Invalid or inactive bank/FI code" — those codes had been transcribed, never proven with a live dispatch. The correct codes (MPESA, AIRTELMONEY, MIXXBYYAS, HALOPESA, TTCLPESA) were taken from Selcom''s published destination-shortcode table and proven with live 1,000 TZS probes to a Vodacom wallet (received, with the provider''s confirmation SMS retained as evidence) and an Airtel wallet before any volume. Production dispatch then moved to routed failover with Selcom primary and Snippe fallback.',
 'Cash-outs were unavailable or worse from 09:08 EAT until the Selcom rail was proven in the afternoon: attempts either refused outright or — the worse case — burned the customer''s nTZS and then failed to pay, leaving the money locked pending manual reconciliation. Two known wallet-holders were stranded this way (one retail app user, two attempts; one WaaS partner whose treasury integration retried four times), 899,034 TZS locked for several hours in total. No money was lost: both providers'' records confirm zero dispatches for the day (the Snippe dashboard lists no 1 August payouts; the only 1 August debit on the Selcom e-statement is our own 1,000 TZS probe), the matching fiat never left the reserve accounts — the reserve was over-backed by the locked sum throughout, never under-backed — and all six burns were minted back on-chain to the source wallets the same day, with the operator confirming the users whole.',
 2, 899034, 0,
 'Three layers. (1) Single-rail dependence: one provider''s unilateral decision — the account flag, for which Snippe has not yet stated a trigger; the most likely candidate is the rapid identical-amount retry pattern our own unguarded retries produced, which resembles the velocity patterns provider risk screens watch for — took every cash-out to zero, because the alternates were not genuinely available (AzamPay disbursements gated on a static egress IP; Selcom disbursements coded but carrying an unproven destination-code vocabulary that failed on first live use). (2) Burn-then-pay with no breaker: flows burned before dispatching, so a dead rail converted each attempt into a stranded burn instead of a clean refusal. (3) No duplicate guard: integrations and users naturally retried into the wall, and each retry burned again — four of the six stranded burns were the same withdrawal.',
 'Same day. Selcom wallet destination codes corrected from the provider''s published table and proven live per network before volume (1,000 TZS probes received on a Vodacom and an Airtel wallet); production dispatch switched to routed failover (Selcom primary, Snippe fallback). With both providers'' records confirming zero dispatches, all six stranded burns were minted back to the source wallets through the audited operator action, and the operator confirmed the users whole. The account flag has been raised with Snippe, which now serves as the redundancy rail.',
 'Cash-out dispatch now walks a rail-priority list with per-rail status polling, and the rail that served each burn is persisted on the row. A pre-burn circuit breaker refuses new cash-outs — with an honest "your balance is untouched" message — once initiations are evidently being refused with zero successes in the window; it fails open, so a broken breaker can never block a healthy rail. Duplicate guards on every cash-out path refuse an identical withdrawal (same source, recipient and amount) within five minutes unless explicitly overridden. Wallet destination codes are sourced from the provider''s published table, committed to the repository, with the standing rule that no network takes volume before one live probe through the gated admin harness (5,000 TZS cap). Stranded burns are resolved through audited operator actions on the reconciliation surface — re-dispatch of the original withdrawal (refused when a payout reference already exists) or mint back — rather than ad-hoc scripts. PRs #206–#213.',
 'PRs #206–#213; provider refusal "your account has been flagged for review" persisted on the six burn rows; Snippe dashboard, 1 Aug (zero payouts); Selcom e-statement, 1 Aug (sole debit: the 1,000 TZS probe); Selcom error 651 on legacy code VMCASHIN; probe ref 16437765-f972-49c4-9231-74f09d815298 with confirmation SMS SB0801M4TAC (Vodacom); audit_logs action burn.operator_force_reverted — six entries, each carrying its remint tx hash; docs/psp/selcom-destination-shortcodes.md')
ON CONFLICT ("ref") DO NOTHING;
