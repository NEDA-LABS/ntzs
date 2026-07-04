# nTZS — IT General Controls (ITGC) & Engineering Best-Practices Program

**Prepared for:** NEDA Labs Limited — Office of the CTO
**Date:** 2 July 2026
**Classification:** Confidential — Regulatory (Bank of Tanzania Sandbox)
**Companion to:** `SECURITY-ASSESSMENT-2026-07.md`

---

## Purpose

This document defines **how nTZS should be built, run, and governed** to meet the standard expected of a regulated stablecoin issuer. It translates global control frameworks into concrete, stack-specific practices for this codebase (Next.js on Vercel, a Node worker + market-maker on Fly.io, Neon PostgreSQL, AWS S3 / Vercel Blob, Base L2 via Alchemy, Gnosis Safe, Snippe/AzamPay).

**Standards anchored to** (name them in the BoT submission and map controls to each):

| Framework | Role here |
|---|---|
| **ISO/IEC 27001:2022** | Information Security Management System (ISMS) — the umbrella certification target |
| **SOC 2 Type II** | Trust Services Criteria (Security, Availability, Confidentiality, Processing Integrity) — customer/partner assurance |
| **NIST CSF 2.0** + **SP 800-53** | Control catalogue and function model (Govern/Identify/Protect/Detect/Respond/Recover) |
| **CIS Controls v8** | Prioritized technical baseline |
| **OWASP ASVS L2** + **OWASP SCVS** | Application and smart-contract verification standards |
| **FSB / MiCA (EMT) reserve principles** | Reserve backing, segregation, attestation (informing BoT expectations) |

ITGCs are audited in five domains; this program is organized the same way so external auditors can map directly.

---

## Domain 1 — Access to Programs & Data (Logical Access)

**Objective:** Only authorized, authenticated, least-privileged identities can reach code, data, secrets, and on-chain authority.

**Current state (from the assessment):** five independent, hand-rolled auth stacks; no central `middleware.ts`; inconsistent fail-open/closed; a hard-coded federation key; no session revocation; secrets in plaintext env vars; crown-jewel keys (MINTER, HD mnemonics) as process env with no HSM.

**Target controls**

1. **Single authorization layer.** Introduce `middleware.ts` enforcing authentication/role on `/api/cron`, `/api/internal`, `/api/debug`, `/api/backstage`, `/api/admin` and every mutating route. Consolidate the five auth stacks onto one session service with uniform, fail-closed secret loading, per-domain secrets, rotation, and **server-side revocation** (a `tokenVersion`/session table checked each request).
2. **RBAC & least privilege.** Documented role matrix (`end_user`, `bank_admin`, `platform_compliance`, `super_admin`, `fund_manager`, `bot_regulator`). Enforce **separation of duties** in code (distinct maker/checker identities and roles for deposits and burns — see assessment H4). DB application role has **no DDL**; a separate read-replica/role serves oversight and the regulator.
3. **MFA everywhere for privileged access.** Enforce MFA on all admin/backstage/CI/cloud-console logins and **hardware keys** for every Gnosis Safe signer.
4. **Key custody (the highest-value control).** Move the MINTER (and BURNER) signer off plaintext env into an **HSM / MPC / KMS-backed signer** (e.g. Fireblocks, Turnkey, AWS KMS) or complete the `mint_requires_safe` multisig path so a raw key never enters the app process. Separate MINTER from BURNER. Separate merchant and LP HD mnemonics. Define and rehearse **key-rotation** for every key/secret (minter, relayer, HD seeds, JWT secrets, service key, PSP keys, `WAAS_ENCRYPTION_KEY` with a key-version in the ciphertext).
5. **Secrets management.** Replace scattered env vars with a managed store (Doppler / AWS Secrets Manager / Vault / Vercel encrypted env). No secret in `NEXT_PUBLIC_*`. Reject known placeholder values. Access to secrets is logged and least-privileged.
6. **Access lifecycle.** Joiner/mover/leaver process; **quarterly access recertification**; break-glass accounts that are logged and alerted; immediate deprovisioning tied to HR events (and to on-chain Safe signer removal).

**Evidence auditors will request:** role matrix, access-review records, MFA enforcement config, Safe signer list + threshold, key-custody architecture, secret-store access logs, rotation runbooks.

---

## Domain 2 — Program Change Management

**Objective:** Every change to code, schema, contracts, and configuration is reviewed, tested, approved, traceable, and safely deployable.

**Current state:** **No CI/CD at all.** No branch protection evidence, no automated tests in the pipeline, no dependency/secret/SAST gates; migrations applied manually; a mutable-tag Docker base image.

**Target controls**

1. **Branch protection on `main`.** Require PR review (≥1 general; **≥2 including a security reviewer for anything touching mint/burn/caps/contracts/auth**), no direct pushes, linear history, and **signed commits**. Codeowners for the money-path directories.
2. **CI security gates (blocking merge).** Stand up GitHub Actions (or equivalent):
   - `npm ci` + `npm audit --audit-level=high` + dependency review;
   - **secret scanning** (gitleaks/trufflehog) + GitHub push protection;
   - **SAST** (CodeQL/Semgrep) and IaC/container scan;
   - **Smart-contract analysis** (Slither/Mythril) + the Hardhat test suite;
   - lint, typecheck, and unit/integration tests with a coverage threshold.
3. **Release & change approval.** A lightweight CAB/record for changes to minting, burning, caps, contract upgrades, and role grants: what changed, who approved, rollback plan, linked ticket. Contract upgrades follow a documented, rehearsed Safe procedure with the audit report attached.
4. **Database migration governance.** Drizzle migrations are reviewed, forward-only, tested on staging, and preceded by a backup; no manual prod DDL. Track applied migrations and reconcile against `drizzle/meta`.
5. **Environment separation & reproducibility.** Distinct dev/stage/prod with no prod secrets in lower environments; `npm ci` from the **root** lockfile only (remove the duplicate `apps/web` lockfile); pin exact versions for signing/auth/DB/contract libraries; pin Docker base images by **digest**; pin the Solidity `evmVersion` and commit a contracts lockfile so on-chain bytecode reproduces.

**Evidence:** branch-protection settings, CI run history, PR review records, CAB log for privileged changes, migration history, upgrade runbooks with signatures.

---

## Domain 3 — Program Development (Secure SDLC)

**Objective:** Security is designed in, not bolted on.

**Target controls**

1. **Threat modeling** (STRIDE) for every feature that touches funds, keys, or PII; a security-review checklist in the PR template.
2. **Acceptance criteria = OWASP ASVS L2.** Input validation via a schema library (e.g. `zod`) at **every** API boundary; output encoding; positive allow-lists for URLs/redirects/content-types (assessment H10, M12); CSV-injection-safe exports (M11).
3. **Smart-contract SDLC to OWASP SCVS:** independent audit **before** mainnet value (retroactively required here), documented invariants, ≥ the negative-authorization and transfer-restriction test matrix, upgrade rehearsals on a fork, and consideration of a timelock and on-chain mint cap.
4. **Test strategy.** Coverage targets on money-path modules; a **regression test for every incident and every finding in the assessment**; contract tests run in CI.
5. **Secure defaults.** Fail closed on missing secrets; constant-time comparisons for all secret checks; no debug endpoints or dev key fallbacks compiled into production builds.

**Evidence:** threat-model docs, PR checklist history, contract audit report, coverage reports, test suites in CI.

---

## Domain 4 — Computer Operations (Run, Monitor, Recover)

**Objective:** The system runs reliably, deviations are detected fast, and the business can recover within regulatory RTO/RPO.

**Target controls**

1. **Automate the security invariants as live, alerting monitors** (today they are dashboard-only in `docs/05`). Continuously check and page on:
   - on-chain `totalSupply` ≠ DB minted + reconciliation (peg/backing integrity);
   - any `Transfer(0x0 → …)` mint without a matching `mint_transactions` row (unauthorized/duplicate mint — catches assessment C1/C2);
   - daily-cap utilization thresholds; minter wallet ETH/gas; `mint_failed` accumulation; webhook failure rate;
   - **reserve ratio < 100%** as a page-immediately condition.
2. **Observability.** Centralized structured logging (with **no secrets/OTP/PII** — fix the stdout OTP/PII leaks), metrics, tracing, and error tracking (Sentry/Datadog/Grafana) routed to on-call. Retain logs per the data-retention policy.
3. **Scheduled-job integrity.** Crons are authenticated (fail-closed), idempotent, monitored, and covered by a **dead-man's switch** that alerts if a job stops running (critical for `daily-attestation` to BoT).
4. **Reserve management & attestation.** Segregated reserve accounts; a documented Reserve Management Policy; **independent (third-party) monthly attestation** plus a real-time proof-of-reserves view. This is *the* stablecoin control and a direct BoT expectation.
5. **Backup & recovery.** Neon point-in-time recovery with **tested quarterly restores**; off-region copies; documented **RTO 4h / RPO 1h** (BoT BC-1) with test evidence and a 30-minute BoT-notification path.
6. **Incident response.** Extend the `docs/06` runbook into tested playbooks (unauthorized mint, key compromise, PSP outage, contract-upgrade rollback, data breach) with severity tiers, on-call rotation, and post-incident reviews feeding regression tests.
7. **Vulnerability & patch management.** SLA-driven remediation (e.g. Critical ≤ 48h, High ≤ 7d), continuous SCA, and a standing dependency-update cadence — closing assessment H11.

**Evidence:** monitor/alert configuration, on-call schedule, restore-test records, attestation reports, incident post-mortems, patch SLAs.

---

## Domain 5 — Third-Party, Vendor & Data Management

**Objective:** External dependencies and personal data are governed and protected.

**Target controls**

1. **Vendor risk & contracts.** Risk assessments and **DPAs/SLAs with breach-notification clauses** for Neon, Vercel, Fly.io, AWS, Alchemy, Snippe, AzamPay, Resend, and the KYC provider (Smile ID). Track vendor SOC 2 reports.
2. **Concentration risk.** Document and plan fallbacks for single points of dependency — one PSP (Snippe), one RPC (Alchemy) — feeding the BoT stress-testing scenarios (reserve depletion, sync failure, volume surge, cyber, custodian).
3. **Data protection & privacy.** Register with the **Tanzania Personal Data Protection Commission** (controller + processor) — already on the sandbox checklist. Classify data; minimize PII (mask payer name/phone on public receipts — assessment M3); encrypt KYC/KYB at rest (S3 SSE-KMS, **private** Blob access + authenticated proxy) with object-level access logging; define retention and erasure schedules.
4. **Supply-chain integrity.** Pin exact versions on security-critical libraries; prefer sandboxed, network-restricted CI builders; `npm ci --ignore-scripts` with an explicit allow-list for native builds; drop unused heavy multi-chain SDKs.

**Evidence:** vendor register + DPAs, PDPC registration, data-classification and retention policies, encryption configuration, SBOM.

---

## Governance & policy layer (documents auditors will ask to see)

For ISO 27001 / SOC 2 / BoT, the controls above must be backed by **written, approved, version-controlled policies** and a living **risk register**:

- Information Security Policy · ISMS scope + Statement of Applicability
- Access Control Policy · **Cryptographic Key Management Policy (CKMS)**
- Secure SDLC & Change Management Policy · Vulnerability & Patch Management Policy
- Logging & Monitoring Standard · **Incident Response Plan** (tested)
- **Business Continuity / Disaster Recovery Plan** (RTO 4h / RPO 1h, tested)
- Data Protection & Privacy Policy · Data Retention & Classification Standard
- Vendor/Third-Party Management Policy · Acceptable Use Policy
- **Reserve Management & Attestation Policy** · **AML/CFT Programme** (KYC/EDD, STR within 24h, FATF Travel Rule)
- Risk register (living), RACI, and a CTO/board security-governance cadence with an independent (or outsourced) internal-audit function.

---

## 90-day quick-start (highest control-value first)

Aligned with the assessment's P0 and the 23 June sandbox testing window:

**Weeks 1–2**
- Stand up CI with `npm audit`/dependency review + secret scanning + push protection + lint/typecheck (Domain 2) — the single highest-leverage control.
- Enable branch protection with required reviews and codeowners on money-path directories.
- Verify the §8 runtime facts from the assessment (CDP env var, Safe-vs-EOA admin, `CRON_SECRET`, worker deployment, AzamPay flag).

**Weeks 3–6**
- Add `middleware.ts` central authorization; fix cron auth fail-closed (assessment C3).
- Move minting to an HSM/MPC/multisig signer; separate MINTER/BURNER (H1, H3).
- Author the CKMS, Access Control, and Change Management policies; publish the role matrix.

**Weeks 7–12**
- Automate the security-invariant monitors with paging + a cron dead-man's switch (Domain 4).
- Stand up independent monthly reserve attestation and a proof-of-reserves view.
- Run a restore test (RTO/RPO evidence); complete the IR and BCP/DR plans and tabletop them.
- Commission the independent smart-contract audit and application penetration test.

---

## Control-to-standard mapping (summary)

| Control area | ISO 27001:2022 | SOC 2 (TSC) | NIST CSF 2.0 | CIS v8 |
|---|---|---|---|---|
| Central auth, RBAC, SoD | A.5.15–A.5.18, A.8.2–A.8.5 | CC6.1–CC6.3 | PR.AA | 5, 6 |
| Key custody / cryptography | A.8.24, A.8.12 | CC6.1, CC6.7 | PR.DS | 3 |
| Change management / CI gates | A.8.25–A.8.32 | CC8.1 | PR.PS, DE.CM | 4, 16 |
| Secure SDLC / app + contract testing | A.8.28, A.8.29 | CC8.1, PI1.x | PR.PS | 16 |
| Monitoring / logging / IR | A.5.24–A.5.28, A.8.15–A.8.16 | CC7.1–CC7.5 | DE.*, RS.* | 8, 13, 17 |
| Backup / BCP-DR | A.5.29–A.5.30, A.8.13–A.8.14 | A1.2, A1.3 | RC.* | 11 |
| Vendor / data protection | A.5.19–A.5.23, A.5.34 | CC9.x, C1.x | GV.SC, PR.DS | 15, 3 |
| Vulnerability & patch mgmt | A.8.8 | CC7.1 | ID.RA, PR.PS | 7 |

---

*Adopting this program does not by itself certify compliance; it establishes the control environment that an ISO 27001 / SOC 2 audit and the BoT sandbox review will test. Prioritize the 90-day quick-start, which also closes the P0 items in the security assessment.*
