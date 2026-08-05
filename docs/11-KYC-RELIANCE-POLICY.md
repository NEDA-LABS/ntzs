# 11 — Customer Due Diligence: Attested Verification Policy

Governs identity verification performed outside the NIDA registry path and recorded in nTZS by attestation — today an internal delegation within NEDA Labs Limited (section 2), and the standing terms for any future grant to a separate entity (section 2.1).

**Reference**: `NEDA-CDD-REL-2026-01`
**Document owner**: NEDA Labs Limited — Office of the CTO
**Effective from**: 5 August 2026
**Review cycle**: Annual, or on any material change to the onboarding process of either party
**Classification**: Confidential — Regulatory (Bank of Tanzania Sandbox)
**Status**: **In force.** This repository holds the text; the executed copy carrying the signatures is held separately by the compliance function. Granted to NEDApay in Backstage on 5 August 2026.
**Next assurance review due**: end of Q4 2026 (section 7)

---

## 1. Purpose

nTZS is a Tanzanian Shilling-referenced stablecoin issued by NEDA Labs Limited. Under the Bank of Tanzania Regulatory Sandbox (Testing Parameter 8), **no end-user wallet may be issued without a verified identity**.

Most Tanzanian customers are verified instantly and automatically: their NIDA number and mobile number are checked as a pair against the national registry through Selcom Identity, corroborated by the telco SIM registration behind the same number (SIM registration in Tanzania requires NIDA plus fingerprints by law). That path is authoritative, cheap, and needs no human.

It cannot cover everyone. Two populations fall outside it:

- **Tanzanians with no registry record** — typically genuine customers who are simply not Selcom Pesa customers. This is a coverage gap, not a fraud signal.
- **Customers holding a non-Tanzanian identity document** — no NIDA exists to check.

This policy governs how those customers are verified: **the customer due diligence is performed in NEDApay's onboarding, and the outcome is attested to nTZS**, which approves the identity case and issues the wallet in one step rather than queueing the customer for a second approval.

## 2. Basis of the arrangement

**NEDApay is a product line and trading name of NEDA Labs Limited — the same legal entity that issues nTZS.**

This is therefore **not reliance on a third party**. NEDA Labs is verifying its own customers, through its own onboarding, and recording the outcome in its own issuing system. No countersignature by a second party is required, no assessment of another firm's AML/CFT supervision arises, and nothing is delegated outside the regulated entity. This document is an **internal delegation of the customer due diligence function** between systems of one firm, approved by the compliance function.

What that does **not** change is the substance. The customer due diligence standard in section 4 must be met, the records in section 5 must exist and be retrievable, and the assurance in section 7 must be performed — because those obligations attach to NEDA Labs as issuer, not to whichever of its systems performs the work. A customer verified in NEDApay's onboarding is a NEDA Labs customer, verified by NEDA Labs.

### 2.1 Grants to a separate legal entity

The technical control this policy governs is general: any partner may in principle be granted the authority to attest. Before it is granted to a party that is **not** NEDA Labs Limited, all of the following must additionally be satisfied, and this policy re-issued under a new reference:

1. A binding reliance agreement executed by both entities on the terms of sections 4–10.
2. A documented assessment that the party is subject to AML/CFT obligations and supervision adequate to support reliance.
3. Confirmation of the Bank of Tanzania's expectations for notification or approval of such an arrangement under the sandbox terms.

As at the date of this policy, **NEDApay is the only grant in force, and clause 2.1 does not apply to it.**

## 3. Scope

**In scope** — customers onboarded through a NEDA Labs partner integration who cannot be verified against the NIDA registry, specifically:

| Population | Why the registry path fails |
|---|---|
| Tanzanian, no Selcom Identity record | Registry coverage, not a fraud indicator |
| Non-Tanzanian identity document | No NIDA exists |
| Tanzanian whose NIDA/phone pair is contradicted by telco registration | Requires a human decision (commonly a SIM registered to a spouse or parent) |

**Out of scope** — everything else. Customers who pass the Selcom NIDA pair check are verified by NEDA Labs directly and are never attested. Business customers (KYB), partner onboarding, and reserve operations are governed separately.

## 4. The standard NEDApay must verify to

An attestation may only be issued where **all** of the following have been performed and recorded:

1. **Identity document.** A current, government-issued photographic identity document — national identity card, passport, driving licence, residence permit or voter identity card — checked for authenticity and not expired at the date of verification.
2. **Identity data captured.** Full name as printed on the document, document type, document number, issuing country, and date of birth.
3. **Person-to-document binding.** A live image of the customer matched to the document photograph, with a liveness check sufficient to defeat a photograph of a photograph. A document alone is not identity — it establishes that a document exists, not that the person presenting it is its holder.
4. **Screening.** The customer screened against applicable sanctions lists and for politically exposed person status, with the result recorded. A positive or inconclusive match must be escalated to a human decision and must not be attested as approved without it.
5. **Attribution.** The identity of the person or system that made the approval decision, and the date and time it was made.

Where any element cannot be completed, the customer is **not** attested as approved. Attesting a rejection (with reasons) or leaving the case for NEDA Labs compliance review are both acceptable outcomes; a weak approval is not.

## 5. Records

NEDApay shall retain, for each attested customer:

- images or certified copies of the identity document relied upon;
- the live image and liveness evidence;
- the screening result;
- the identity of the decision-maker and the timestamp of the decision;
- the internal case reference transmitted to NEDA Labs.

**Retention**: not less than **ten (10) years** from the end of the customer relationship, or such longer period as the Anti-Money Laundering Act and its regulations, the Financial Intelligence Unit, or the Bank of Tanzania may require.

**Production on demand**: within **two (2) business days** of a written request from NEDA Labs compliance, the Bank of Tanzania, the Financial Intelligence Unit, or an appointed auditor. This obligation is the whole basis of reliance — if the underlying record cannot be produced, the verification did not happen as far as the regulator is concerned.

## 6. How an attestation is transmitted

NEDApay reports each decision to `POST /api/v1/users/:id/kyc/attestation`. The technical control is documented in `09-WAAS-PARTNER-API.md`; the compliance-relevant properties are:

| Property | Control |
|---|---|
| Authority to attest | A per-partner grant (`partners.kyc_attestation_enabled`), off by default, set only by NEDA Labs compliance in Backstage against **this document's reference**. An API key alone cannot approve an identity. |
| Mandatory evidence fields | `reference` (NEDApay's own case id), `verifiedBy`, `verifiedAt`, `country`, `idType`, `idNumber`, `fullName`. An attestation that cannot state who verified, when, and against what document is rejected. |
| Freshness | A decision dated more than **365 days** before receipt is refused rather than replayed. |
| Consistency | A document number contradicting an identity number already held for that customer is refused. One document identity may back at most one customer. |
| Audit trail | Every attestation is written to `audit_logs` with the partner, the case reference, the verifier, the verification timestamp, the document type and country, and this agreement reference. |
| Effect | The identity case is approved and the wallet is issued in the same operation. There is no second approval step. |

## 7. Assurance

NEDA Labs compliance shall, **quarterly**, select a random sample of attested customers — at least 10% of attestations in the period, and never fewer than five where that many exist — and request the underlying records under section 5. The review tests that the records exist, that they support the decision attested, and that the standard in section 4 was met.

Findings are recorded and, where material, trigger suspension under section 9. The sample and its outcome form part of the periodic reporting to the Bank of Tanzania.

## 8. Responsibility is not transferred

Delegation places the **performance** of customer due diligence with the NEDApay onboarding process. It does not move the **responsibility** for it — and where the performing party is the same legal entity, as it is today, there was never anywhere for that responsibility to move to. NEDA Labs Limited, as issuer of nTZS, is fully accountable to the Bank of Tanzania for the adequacy of customer due diligence on every wallet it issues, and for the consequences of any failure.

Accordingly NEDA Labs retains, at all times and without notice, the right to:

- require the underlying records for any customer;
- re-verify any customer directly;
- refuse or reverse an approval and freeze the associated wallet;
- suspend or withdraw reliance under section 9.

## 9. Suspension and withdrawal

The grant may be withdrawn at any time by NEDA Labs compliance, taking effect immediately upon revoking it in Backstage. Existing customers already verified remain verified; no new attestation is accepted from that moment.

The grant **shall** be suspended where: records requested under section 5 are not produced within the stated period; an assurance review under section 7 finds attestations unsupported by underlying records; or the Bank of Tanzania directs it.

Withdrawal has an operational consequence that must be planned for, not discovered: customers in scope under section 3 have no other automated verification path, so while the grant is suspended they fall to manual compliance review and wallet issuance slows to that queue.

## 10. Change control

Any material change to NEDApay's onboarding or verification process shall be notified to NEDA Labs compliance **before** it takes effect. This document is reviewed annually and on any such change. Superseding versions take a new reference in the series `NEDA-CDD-REL-YYYY-NN`.

---

## Signature

**Executed 5 August 2026.** The signed copy is authoritative and is held by the compliance function; the block below is the template it was executed against. A superseding version takes a new reference (section 10) and is signed afresh — this block is never amended in place, so the repository history shows which text was in force at any date.

Two signatures, both within NEDA Labs Limited: the executive who owns the decision, and the compliance function that owns the control. They should not be the same person — a delegation of the CDD function approved by one signature is not a maker-checker control, and every other approval in this platform is.

**For NEDA Labs Limited (issuer of nTZS):**

| | |
|---|---|
| Name | |
| Position | |
| Signature | |
| Date | |

**Compliance function approval:**

| | |
|---|---|
| Name | |
| Position | |
| Signature | |
| Date | |

---

## Appendix A — Attestation field mapping

The evidence required by section 4 maps to the API contract as follows. Fields marked ✓ are mandatory on an approval and validated server-side.

| Section 4 requirement | API field | Mandatory |
|---|---|---|
| Document type | `idType` | ✓ |
| Document number | `idNumber` | ✓ |
| Issuing country | `country` | ✓ |
| Name as printed | `fullName` | ✓ |
| Decision-maker | `verifiedBy` | ✓ |
| Decision timestamp | `verifiedAt` | ✓ (≤ 365 days old) |
| NEDApay case reference | `reference` | ✓ |
| Verification method | `method` | Recommended |
| Rejection reason | `notes` | ✓ on rejection |

Date of birth, the live image, the liveness evidence and the screening result are **retained by NEDApay** and produced under section 5; they are deliberately not transmitted to NEDA Labs, which minimises duplication of customer personal data across systems.

---

## Appendix B — Points requiring professional review before submission

The legal-entity question that would have been the significant one is settled: NEDApay and NEDA Labs Limited are the same entity, so no third-party reliance arises and nothing here needs another party's signature. What remains is narrower, and none of it blocks internal operation — but it should be confirmed by qualified counsel before this policy supports a filing to the Bank of Tanzania:

1. **Section 5 retention period** — ten years is stated as the conservative position; confirm against the Anti-Money Laundering Act and its current regulations. Retaining longer than required is never a breach; retaining less can be.
2. **Section 4(4) screening** — confirm which sanctions lists NEDA Labs is obliged to screen against, and whether the sandbox terms impose PEP requirements beyond those stated.
3. Whether the Bank of Tanzania expects **notification** that identity verification for the section 3 population is performed in the NEDApay onboarding process rather than in nTZS directly. This is disclosure of an internal process split, not of an outsourcing arrangement, so it most likely belongs in ordinary periodic reporting — but confirm rather than assume.
