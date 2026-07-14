# BoT Pre-Testing On-Site Inspection — Document Pack

**Onsite:** 9 July 2026 · **Testing commences:** 15 July 2026 · **Sandbox Ref:** LD.170/515/02/1254
**Contact:** Victor Muhagachi, CTO — victor@nedapay.xyz

## Documents in this pack (drafted 8 July 2026)

| # | Document | Checklist item(s) |
|---|---|---|
| — | `figures/system-architecture.svg` | §2 Architecture diagram |
| 01 | System Architecture | §2 Technology |
| 02 | AML/CFT & STR Procedure | §4 AML/CFT |
| 03 | Incident Response Plan | §5 Ops & cybersecurity |
| 04 | Key Management & Access Controls | §5 Ops & cybersecurity |
| 05 | Consumer Complaint Handling Process | §6 Consumer protection |
| 06 | Reserve Composition & Custody | §3 Reserve arrangements |
| 07 | Sandbox Tester Disclosure (EN + SW) | §6 Consumer protection / §13 |

> These are **drafts** for review. They state the current control state honestly (e.g., Cohort-1 self-KYC
> with the Selcom bank-grade roadmap; mint and burn currently share one key). Review names, dates, and any
> figures before submission.

## Live-system evidence (walk BoT through the Oversight portal)

- **Reserve Proof** + **Daily Attestation (10:00 EAT)** — reserve vs circulating nTZS, 1:1 (§3).
- **Audit trail with cash-before-mint provenance** — proves mint-only-after-cash (§2, §4).
- **Issuance Controls** — 1M / 2M / 60M / 100M limits, enforced (§4).
- **Identity & AML** — honest KYC cohorts + control inventory (§4).
- Contract verifiable on **BaseScan** — `0xF476BA983DE2F1AD532380630e2CF1D1b8b10688` (§2).

## Still required — business / legal (not producible from the system)

| Item | Checklist | Note |
|---|---|---|
| Org chart & roles (Victor, David, Baraka) | §1 | One-pager |
| Board/founder resolutions tied to sandbox | §1 | Legal |
| Reporting-line ownership (monthly/mid-term/final) | §1 | Assign owners |
| **Selcom custody confirmation letter** | §3 | **Highest-priority gap — flag proactively if pending** |
| **Cantina audit report** (commit `e7ac3ac4`, zero findings) | §2 | Ensure the PDF is on hand |
| Team monitoring capacity (15 Jul–16 Oct) | §5 | Confirm staffing |

## Two decisions for the day

1. **Selcom custody letter** — present executed letter, or an honest interim-custody plan + timing.
2. **Live demo vs. wallet-creation pause** — demo on an existing test account, or temporarily set
   `WALLET_CREATION_PAUSED=false` for the walkthrough then re-pause. Frame the pause as a **strength**:
   no wallet is issued without KYC (Parameter 8).
