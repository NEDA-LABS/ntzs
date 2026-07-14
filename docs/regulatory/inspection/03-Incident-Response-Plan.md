# nTZS — Incident Response Plan

**Prepared for:** Bank of Tanzania — Pre-Testing On-Site Inspection
**Sandbox Ref:** LD.170/515/02/1254 · **Prepared:** 8 July 2026
**Owner:** Victor Muhagachi, CTO — victor@nedapay.xyz

## 1. Purpose & scope

Defines how NEDA LABS detects, classifies, contains, and reports incidents affecting the nTZS
sandbox — covering reserve integrity, smart-contract security, platform availability, PSP failures,
data protection, and AML events — during the testing period (15 Jul – 16 Oct 2026).

## 2. Severity levels

| Sev | Definition | Examples | BoT notification |
|---|---|---|---|
| **SEV-1 Critical** | Peg/reserve at risk, funds at risk, or key compromise | Reserve < circulating nTZS; minter/upgrade key compromise; unauthorized mint | **Immediate** (within 1 hour) |
| **SEV-2 High** | Core function down or material control failure | Mint/redeem pipeline failure; PSP outage blocking settlement; reconciliation drift beyond tolerance | Same business day |
| **SEV-3 Moderate** | Degraded service, no fund risk | Elevated error rates; delayed webhooks | Included in monthly report |
| **SEV-4 Low** | Minor/cosmetic | UI defects | Logged only |

## 3. Detection

- **Reserve/peg:** the daily 10:00 EAT attestation flags any under-backing (`within_kpi = false`) and continuous reconciliation raises drift alerts by email.
- **Availability & errors:** platform monitoring and PSP webhook failure logs.
- **Security:** on-chain monitoring of the nTZS contract roles and Safe multisig activity.
- **AML:** limit-breach and suspicious-pattern flags (see AML/CFT procedure).

## 4. Response workflow

1. **Identify & classify** severity (table above).
2. **Contain** — invoke the relevant control:
   - Reserve breach / suspected unbacked supply → **suspend new minting** (kill-switch); redemptions remain available.
   - Contract/security → **pause** mint & swap; convene multisig signers.
   - PSP failure → hold settlements; the burn-then-payout flow **re-mints** on payout failure so no holder is left short.
   - AML → **freeze** the affected wallet(s) pending review.
3. **Notify** — per the severity table; SEV-1/SEV-2 to BoT (and the partner bank where relevant).
4. **Eradicate & recover** — fix root cause, verify reserve = circulating supply, resume normal operation on sign-off.
5. **Post-incident review** — written within 5 business days: timeline, impact, root cause, corrective actions.

## 5. Roles & contacts

| Role | Person | Responsibility |
|---|---|---|
| Incident Commander | Victor Muhagachi (CTO) | Decisions, BoT communication |
| Engineering | David | Containment, recovery |
| Operations / Compliance | Baraka | Monitoring, AML actions, records |

Primary contact for the day / duration: **Victor Muhagachi — victor@nedapay.xyz**.

## 6. Communication

- **BoT:** SEV-1 immediate; SEV-2 same day; all incidents summarised in the monthly compliance report.
- **Partner bank (Selcom):** any reserve, settlement, or AML incident.
- **Customers:** affected testers notified with status and expected resolution.

## 7. Testing & maintenance

An incident-response drill is conducted before each 3-month sandbox phase, and this plan is updated
after any material incident or architecture change.
