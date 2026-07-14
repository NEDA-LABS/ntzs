# nTZS — Consumer Complaint Handling Process

**Prepared for:** Bank of Tanzania — Pre-Testing On-Site Inspection
**Sandbox Ref:** LD.170/515/02/1254 · **Prepared:** 8 July 2026
**Owner:** Operations (Baraka) · Escalation: Victor Muhagachi, CTO

Consistent with Tanzanian consumer-protection law and Testing Parameters 12 & R-11.

## 1. Channels

- **Email:** support@ntzs.co.tz / devops@ntzs.co.tz
- **In-app:** support contact within the NEDApay app.
- All complaints are logged in a central complaint register on receipt (ID, timestamp, tester, category, description).

## 2. Service levels

- **Acknowledgement:** within **1 business day**.
- **Resolution target:** **≥ 90% of complaints resolved within 5 business days.**
- Complaints unresolved within 5 business days are **escalated** to the CTO and tracked to closure.

## 3. Categories

Deposit/mint delays · redemption/payout delays · incorrect balance · failed transaction · KYC/verification ·
suspected fraud/unauthorised activity · fees/disclosure · other.

## 4. Workflow

1. **Log** the complaint with a unique reference.
2. **Acknowledge** to the tester with the reference and expected timeline.
3. **Investigate** — reconcile against on-chain records, PSP records, and the reserve ledger.
4. **Resolve** — correct the issue; where funds are due, process **nTZS→TZS redemption** or refund via the PSP.
5. **Close** — inform the tester of the outcome; record the resolution and time-to-resolve.
6. **Escalate** unresolved or high-severity cases to the CTO, and to BoT / the partner bank where warranted.

## 5. Refund & redemption

- Testers may redeem nTZS to TZS at any time (subject to sandbox limits); redemption pays out to mobile money via the PSP.
- Where a complaint establishes that funds are owed, the refund follows the same audited burn-then-payout path, with re-mint protection if a payout fails.

## 6. Reporting

- **Quarterly** complaint metrics (volume, categories, time-to-resolve, resolution rate) are shared with BoT in the progress report.
- Any complaint indicating a systemic issue or consumer harm is escalated to BoT promptly.

## 7. Records

Complaint records are retained for the sandbox period and available for BoT inspection.
