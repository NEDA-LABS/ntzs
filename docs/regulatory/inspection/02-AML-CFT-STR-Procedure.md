# nTZS — AML/CFT & Suspicious Transaction Reporting Procedure

**Prepared for:** Bank of Tanzania — Pre-Testing On-Site Inspection
**Sandbox Ref:** LD.170/515/02/1254 · **Prepared:** 8 July 2026
**Owner:** Compliance (Victor Muhagachi, CTO) · **Applies to:** Testing period 15 Jul – 16 Oct 2026

This procedure documents the customer due-diligence, transaction-monitoring, and suspicious-activity
reporting controls for the nTZS sandbox, mapped to Testing Parameters 8, 10, and 11. It states the
**current control state honestly** and the **committed roadmap**; nothing is represented as operational
before it is.

## 1. Customer Due Diligence (KYC)

Wallets are onboarded in cohorts, reported by verification method — **no anonymous wallets** (Para 8(e)):

**Cohort 1 — current pilot users (self-administered):**
- Government **national ID** captured and reviewed by NEDA compliance.
- **Mobile OTP** authentication for account access.
- **Blockchain wallet bound to a verified identity** (1 identity ↔ 1 wallet).
- Source of TZS funds self-declared at deposit.

**Cohort 2 — bank-grade (via partner bank, roadmap):**
- Tier-1 verification through **Selcom bank-ID**: national ID + **biometric selfie** + approved-provider checks.
- **PEP screening + sanctions screening (UN / BoT / OFAC) before wallet activation.**
- AML/CFT custody performed by the BoT-licensed partner bank (Para 6 & 15).

> **Current-state control:** During the pre-KYC-uplift window, **new wallet issuance is paused** on both
> the direct app and the WaaS API. No new wallet can be created without KYC; existing pilot wallets are unaffected.

## 2. Transaction monitoring & limits (enforced in code)

| Control | Limit | Status |
|---|---|---|
| Per-transaction cap | 1,000,000 TZS | Enforced |
| Daily aggregate per user | 2,000,000 TZS | Enforced |
| Monthly aggregate per user (30-day rolling) | 60,000,000 TZS | Enforced |
| Platform daily volume ceiling | 100,000,000 TZS | Enforced — new transactions auto-suspend at the ceiling; BoT notified |
| Test cohort size | 100 users | Controlled — new onboarding currently paused |

Limits apply across issuance, transfers, and redemption. Breaches are rejected at the API boundary
before any money moves, and are visible in the Oversight portal's Issuance Controls.

## 3. Enhanced Due Diligence (EDD)

EDD is triggered for high-risk customers or large/atypical transactions. It involves:
collection of additional identity documents and proof of source of funds/wealth, transaction-purpose
review, manual or video review, and **senior compliance sign-off** before proceeding. An EDD log is
maintained and weekly EDD metrics are provided to BoT. *(Current state: manual; automated triggers land with the bank integration.)*

## 4. Suspicious Transaction Reporting (STR)

1. **Detect** — automated limit/pattern flags plus staff review surface potential suspicious activity.
2. **Investigate** — compliance reviews the customer, funds source, and transaction context; the account may be **frozen** (BLACKLISTER role) pending review.
3. **Report** — a Suspicious Transaction Report is filed with the **Financial Intelligence Unit (FIU) within 24 hours** of detection.
4. **Record** — the report, evidence, and decision are retained; **monthly STR statistics are shared with BoT**.

During the sandbox, STR filing is channelled through the partner bank's licensed AML/CFT function;
NEDA maintains the detection, investigation, and record-keeping steps above.

## 5. Record-keeping

All KYC records, transaction data (on-chain and off-chain), reserve movements, and AML decisions are
retained and are available for BoT inspection at any time. On-chain mints/burns are permanently
timestamped; off-chain references link each to its PSP and bank records.

## 6. Governance

- Compliance owner: Victor Muhagachi (CTO).
- Escalation: material AML events are reported to BoT and the partner bank immediately.
- This procedure is reviewed each 3-month sandbox phase and updated as the Selcom KYC/AML integration goes live.
