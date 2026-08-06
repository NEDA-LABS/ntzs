# Incident Notification — Payment Service Provider Account Suspension

**To:** Bank of Tanzania — Regulatory Sandbox / National Payment Systems
**From:** NEDA Labs Limited
**Sandbox Ref:** LD.170/515/02/1254
**Incident Ref:** INC-2026-08-002
**Date of incident:** 6 August 2026
**Classification:** Regulatory — Bank of Tanzania Sandbox Submission
**Status:** ⚠️ DRAFT — for review and signature before issue

---

## 1. Purpose

This notification reports an incident on the nTZS platform on 6 August 2026, assessed by us as **Severity 2** under our incident management policy. We are notifying the Bank directly rather than waiting for the next periodic return, for two reasons: a third party has made an allegation about the nature of our activity that the Bank should hear from us first, and our own daily reserve report was materially incorrect for part of that day.

No customer has been shown to have lost funds. The reserve remains fully backed.

## 2. The allegation, and our position on it

On 6 August 2026 one of our payment service providers, Snippe, suspended our account. Their notice states the reason as:

> "Suspected unlicensed betting/gaming activity conducted through this account."

**NEDA Labs does not conduct, process, facilitate or settle betting or gaming activity of any kind.** nTZS is a Tanzanian Shilling-referenced stablecoin operating under this sandbox authorisation. Every wallet holder is identity-verified before issuance under Testing Parameter 8, every deposit and redemption is recorded against a verified identity, and the platform has no betting or gaming merchant, integration or counterparty.

The provider has not identified the transactions that prompted the review. We have asked them to do so and have offered our sandbox authorisation to their compliance function. We assess the most likely trigger as our own transaction pattern rather than any counterparty: sandbox activity consists of small, frequent, often identical-amount mobile-money transactions, which resembles the velocity signature that provider risk screens are built to flag. A related incident on 1 August (INC-2026-08-001) saw the same provider flag the same account without stating a reason, and our register at that time recorded an unguarded retry loop on our side as the likely cause.

We record this as a supervision-relevant fact and not merely a commercial dispute, because an allegation of unlicensed activity against a sandbox participant is properly the Bank's to know about.

## 3. What happened

The provider's notice stated that all transactions, API keys and payment pages were disabled, and that our balance remains in the account. Two consequences reached production.

**Vodacom M-Pesa deposits stopped.** This provider was the only rail able to collect from Vodacom M-Pesa. Our second collection provider has not completed its own Vodacom onboarding, and a third path is implemented but was not enabled. Because our credentials were invalidated rather than our requests accepted, deposit attempts were refused outright by the provider — a clean refusal, not money taken without credit.

**Our daily reserve attestation understated coverage.** The 10:00 EAT run could not read the balance held with this provider and dropped that component from the reserve sum entirely, computing provisional coverage of **67.69%** against a true position above 100%.

That report was **not** sent to the Bank. The platform correctly classified the reading as INCOMPLETE, routed the alert to our internal operations list, and persisted no record for the day — the existing control that no degraded reading is ever attested worked as designed. Nonetheless, our own statement of our reserve position was materially wrong between that run and its correction the same day, and we report it as such.

## 4. Customer impact

| | |
|---|---|
| Vodacom M-Pesa deposits | **Unavailable** from the suspension and at the date of this notice |
| Deposits on Airtel, Tigo/Yas, Halotel | Unaffected |
| Bank-transfer deposits | Unaffected |
| Cash-out payouts | Unaffected — served by a different provider |
| Transfers, swaps, on-chain balances | Unaffected |
| Customer funds lost | **None shown; see below** |

Customers attempting an M-Pesa deposit now receive a message naming their network, stating the cause is ours and temporary, offering an alternative network or bank transfer, and confirming their balance is untouched and nothing has been charged.

**On customer losses.** No customer has been shown to have lost funds and we do not expect any to have. We report the figure as **unestablished rather than zero**, in line with our policy that a loss figure is never defaulted to zero before it is established: a collection in flight at the moment the account was disabled cannot be excluded until we have read the provider's statement of the account. Three deposit attempts on the morning of 6 August, across two wallet holders, are under review on the same basis; two of the three timestamp before the first evidenced effect of the suspension and may belong to a separate, already-corrected defect.

We will confirm the position in writing once the provider's statement is received.

## 5. Reserve position

The reserve is fully backed. The balance held with the suspended provider has not moved and, per the provider's own notice, cannot move while the account is suspended.

Because that balance can no longer be read through the provider's interface, the reserve component is currently evidenced by other means, and every report carrying it is **qualified on its face**: it names the source, states the date the figure was true, and states that it is not verified as at the date of the report. We have asked the provider for a statement of the account balance, which they have agreed to supply while API access is withheld.

We draw the Bank's attention to the limits we have placed on this. A substituted figure **expires**: seven days for a balance carried forward from our own last verified reading, thirty days for a statement issued by the custodian confirming an account it has frozen. After expiry the daily report refuses to attest and requires a person to decide. These limits are controls and we do not intend to extend them to keep a figure alive; if the suspension outlasts them, the answer is reinstatement or relocation of the balance, not a longer clock.

## 6. Root cause

1. **Single-provider dependence for Vodacom M-Pesa collections.** One provider's unilateral decision removed an entire network, because the alternatives were not genuinely available. This is the same structural weakness identified in INC-2026-08-001 on the payout side, on the side we had not yet addressed.
2. **Our regulatory standing was never lodged with the provider's risk function**, so their screening assessed our transaction pattern without the context that explains it.
3. **Reserve verifiability rested on a single interface per holding**, with no route to accept a balance the custodian stated to us by other means.
4. **A defect of our own:** the attestation treated an unreadable holding as an absent one, converting a provider outage into an apparent collapse in coverage. This is the element of the incident that is properly ours, and it is why the incident is reportable rather than merely operational.

## 7. What has changed

- A reserve holding that cannot be read is now **substituted from the best available evidence** — the custodian's own statement where one exists, otherwise our last verified reading — and the report is marked qualified, naming the source and the date. There is no longer any path by which an unreadable holding silently becomes a missing one.
- Both substitutions carry a **hard expiry**, after which the report refuses to attest.
- A statement entered from a provider requires a **reference to the underlying document**, and asserting that an account is frozen requires the evidence for that assertion. Both are recorded against the individual who entered them.
- A provider can be **removed from all payment routing without deleting credentials**, so customers are never offered a rail certain to refuse.
- Customers who cannot be served receive a **written explanation** rather than a failure.
- Each of these is covered by automated tests, including a test that asserts the incorrect arithmetic which produced the 67.69% figure is no longer reachable.

## 8. Current status and next steps

| | |
|---|---|
| Suspension | **Unresolved.** Reason disputed; provider asked to identify the transactions concerned and to receive our sandbox authorisation |
| Vodacom M-Pesa deposits | **Unavailable.** Restoration requires reinstatement, or enabling a third collection path already implemented |
| Reserve | Fully backed; the affected component evidenced by statement, every report qualified on its face |
| Customer losses | Unestablished; to be confirmed on receipt of the provider's statement |

We will report the outcome, the confirmed loss figure and the restoration of M-Pesa collections in the next periodic return, or sooner if the position changes materially.

---

**Signed for NEDA Labs Limited**

| | |
|---|---|
| Name | |
| Position | |
| Signature | |
| Date | |
