# Attested KYC — integration brief

**For**: the NEDApay engineering team
**Companion policy**: `docs/11-KYC-RELIANCE-POLICY.md` (`NEDA-CDD-REL-2026-01`)
**Base URL**: `https://www.ntzs.co.tz`

---

## What this is

Most Tanzanian customers are verified automatically when you create them: we check their NIDA number and phone as a pair against the national registry, and the wallet comes back in the same response. You do nothing.

This brief is about **the customers that check cannot cover**:

- Tanzanians the registry has no record of — usually genuine people who simply aren't Selcom Pesa customers.
- Anyone holding a **non-Tanzanian** identity document. No NIDA exists to check.
- Tanzanians whose NIDA and phone are contradicted by the telco's SIM registration (commonly a SIM registered to a spouse or parent).

For those, **you** verify the customer in NEDApay's onboarding and tell us the outcome. Your approval approves our identity case and issues the wallet in the same call. There is no second review on our side and no waiting.

---

## Before you write any code

Three things must be true or nothing below works.

1. **You have a live API key** (`ntzs_live_…`). Every call is `Authorization: Bearer <key>`.
2. **Attestation authority is switched on for your key.** It is off by default. Until NEDA Labs compliance enables it, every attestation returns `403 kyc_reliance_not_granted` — that is the control working, not a bug. Ask compliance, not engineering.
3. **The customer exists in nTZS.** You cannot attest a customer we have never heard of. Step 1 below creates them and gives you the id every later call needs.

---

## Step 1 — Create the customer

`POST /api/v1/users`

This is where `ntzsUserId` comes from. **Store the `id` it returns against your own user record** — every later call needs it, and there is no lookup endpoint that will find it for you afterwards.

**Non-Tanzanian customer** — no NIDA, so don't send one:

```http
POST /api/v1/users
Authorization: Bearer ntzs_live_xxxxxxxxxxxx
Content-Type: application/json

{
  "externalId": "your-internal-user-id",
  "email": "jane@example.com",
  "name": "Jane Wanjiru Doe",
  "phone": "+254712345678",       // optional; E.164 if sent
  "country": "KE"                  // ISO 3166-1 alpha-2 — NOT "TZ"
}
```

**Tanzanian customer** — always send the NIDA and phone. Most will verify instantly here and never need step 3:

```http
{
  "externalId": "your-internal-user-id",
  "email": "asha@example.com",
  "phone": "0713712057",
  "nidaNumber": "19900101123456789012"
}
```

### Read the response, don't assume

| Status | What it means | What to do |
|---|---|---|
| `201` with `walletAddress` | Verified against the NIDA registry. Done. | Nothing. **Do not attest this customer** — they are already approved. |
| `202` with `nextStep: "kyc_attestation"` | We cannot verify them. It's yours. | Go to step 2. |
| `202` with `nextStep: "compliance_review"` | We cannot verify them, and your key is not authorised to attest. | Check prerequisite 2 above. Otherwise they wait for our compliance team. |
| `400 kyc_required` | Tanzanian customer with no `nidaNumber`. | Send the NIDA. |
| `409 nida_already_registered` | That NIDA already backs another of your users. | Investigate — one identity, one wallet. |
| `503 kyc_unavailable` | The registry is temporarily unreachable. | Retry later. This is not a rejection. |

The call is idempotent on `externalId`: re-calling it returns the existing customer rather than creating a second one. Safe to retry.

---

## Step 2 — Verify the customer, properly

This is not a formality, and the fields in step 3 are not decorative — they are what we hand the Bank of Tanzania when asked how a given wallet holder was verified. Before you attest an approval you must have done, and **kept**, all of the following:

1. **A current government-issued photo document** — national ID, passport, driving licence, residence permit or voter ID — checked as genuine and not expired.
2. **The identity data**: full name as printed, document type, document number, issuing country, date of birth.
3. **A live image of the customer matched to the document photo**, with a liveness check. A document on its own proves a document exists, not that the person holding it is its owner.
4. **Sanctions and PEP screening**, with the result recorded. A positive or unclear match goes to a human — never straight to an attested approval.
5. **Who decided, and when.**

**Retention**: keep the document images, the liveness evidence, the screening result and the decision record for **ten years** after the relationship ends, and be able to produce any of it **within two business days** of a request. That production obligation is the whole basis of this arrangement — a record you cannot produce means, to a regulator, that the verification never happened.

If any element is missing, do not attest an approval. Attesting a rejection is fine. Leaving the customer for NEDA Labs compliance review is fine. A thin approval is not.

---

## Step 3 — Attest the outcome

`POST /api/v1/users/{ntzsUserId}/kyc/attestation`

```http
POST /api/v1/users/14e17d04-ec7f-4d99-91a3-dfbaca19fba1/kyc/attestation
Authorization: Bearer ntzs_live_xxxxxxxxxxxx
Content-Type: application/json

{
  "decision":   "approved",
  "country":    "KE",
  "idType":     "PASSPORT",
  "idNumber":   "A1234567",
  "fullName":   "Jane Wanjiru Doe",
  "reference":  "NEDAPAY-KYC-88213",
  "verifiedBy": "compliance@nedapay.xyz",
  "verifiedAt": "2026-08-04T09:30:00Z",
  "method":     "document_and_selfie"
}
```

```json
200 OK
{
  "id": "14e17d04-ec7f-4d99-91a3-dfbaca19fba1",
  "externalId": "your-internal-user-id",
  "kycStatus": "approved",
  "caseId": "6f1e...c2a9",
  "walletAddress": "0x531B87EfdEBD19bfd05700DF6218d4786Cf2201C"
}
```

The wallet is live when that response returns. There is nothing else to call.

### Rejecting

```json
{
  "decision":   "rejected",
  "country":    "KE",
  "reference":  "NEDAPAY-KYC-88214",
  "verifiedBy": "compliance@nedapay.xyz",
  "verifiedAt": "2026-08-04T09:35:00Z",
  "notes":      "Document expired in 2021; customer asked to re-submit."
}
```

`notes` is required on a rejection and `idType` / `idNumber` / `fullName` are not — you can refuse someone precisely because their document was unusable. The customer can be re-attested later with a fresh verification.

### Fields

| Field | Required | Notes |
|---|---|---|
| `decision` | — | `approved` (default) or `rejected` |
| `reference` | ✓ | **Your** case id, 4–128 chars. How we ask you for the file later — make it resolvable in your own system. |
| `verifiedBy` | ✓ | Reviewer email, team, or system identifier. Who is accountable for this decision. |
| `verifiedAt` | ✓ | ISO 8601. Not in the future, not more than **365 days** old. |
| `country` | ✓ | ISO 3166-1 alpha-2 of the **document**, not the customer's residence. |
| `idType` | ✓ on approval | `NATIONAL_ID`, `PASSPORT`, `DRIVERS_LICENSE`, `RESIDENCE_PERMIT`, `VOTER_ID` |
| `idNumber` | ✓ on approval | As printed, 3–64 chars. Punctuation and spacing are ignored when we compare. |
| `fullName` | ✓ on approval | As printed on the document. Must be at least two name components. |
| `notes` | ✓ on rejection | The reason, in words the customer can act on. |
| `method` | — | Free text, e.g. `document_and_selfie`. Recommended. |

---

## Errors, and what to do about them

| Status | Code | What it means | Do this |
|---|---|---|---|
| `403` | `kyc_reliance_not_granted` | Your key isn't authorised to attest. | Not an engineering fix. Ask NEDA Labs compliance to enable it. |
| `404` | — | That user id doesn't belong to you. | Wrong id, or the customer was never created. Check step 1. |
| `400` | `verified_at_stale` | The decision is over a year old. | Re-verify the customer. Don't backdate. |
| `400` | `verified_at_future` | Clock skew, or a bad timestamp. | Send real UTC. |
| `400` | `invalid_id_type` | Document type not on the list. | Use one of the five. If you genuinely need another, ask — don't force-fit. |
| `400` | `notes_required` | Rejection with no reason. | Add `notes`. |
| `409` | `identity_mismatch` | The document number contradicts an identity number we already hold for this customer. | **Stop and investigate.** Usually the NIDA sent at step 1 and the document verified at step 2 belong to different people. Do not retry with different data to make it pass. |
| `409` | `identity_already_registered` | That document already backs another of your users. | One identity, one wallet. Likely a duplicate account. |
| `409` | `kyc_already_decided` | Our reviewer decided it first. | Fetch `GET /api/v1/users/:id` for the current status. |
| `500` | — | Our fault. | Retry with the same body — it's idempotent. |

**Retries are safe.** Re-attesting a customer who is already approved returns `200` with `alreadyVerified: true` and the same wallet address. It never creates a second wallet, and it never double-counts.

---

## Three things that will catch you out

**1. For a Tanzanian, `idNumber` must be the same NIDA you sent at step 1.** If you created them with NIDA `1990…7890` and then attest `idType: "NATIONAL_ID"` with a different number, you get `409 identity_mismatch`. That's deliberate — a genuine document belonging to somebody else must never approve a case.

If you verified a Tanzanian on their **passport** instead, send `idType: "PASSPORT"` and the passport number. We only compare like with like, so a passport number differing from their NIDA is expected and won't be refused.

**2. Don't attest customers who came back `201`.** They were already verified against the registry and already have a wallet. Only `202` customers need step 3. Attesting an approved customer isn't harmful — it's a no-op — but it means your logic isn't reading `nextStep`, and that same bug will silently skip customers who *do* need attesting.

**3. Attestation is not available on test keys.** A `ntzs_test_…` key returns "not supported" here. To exercise the review branch in sandbox, create a user with a NIDA ending `0000` (which returns `202`) and clear it with `POST /api/v1/testmode/users/:id/approve`. That fires the same `kyc.updated` webhook and produces the same wallet, so you can build and test the whole downstream flow — you just can't rehearse this exact endpoint until you're on a live key.

---

## What we deliberately do not want

**Do not send us document images, selfies, liveness frames, dates of birth, or screening reports.** Not in these fields, not in `notes`, not anywhere.

That is a design decision, not an oversight. Those records stay in your onboarding system, where they already are, and we hold only the attestation — who verified, when, which document, under which reference. It means one copy of each customer's sensitive documents exists rather than two, and a breach of the issuing platform exposes no customer document images at all. The `reference` field is the link that lets anyone who is entitled to see the underlying file ask you for it.

---

## Webhook

We also fire your existing `kyc.updated` partner webhook after each attestation:

```json
{ "externalId": "your-internal-user-id",
  "kycStatus": "approved",
  "provider": "partner_attested",
  "reference": "NEDAPAY-KYC-88213" }
```

Redundant if the service that attests is the service that provisions — but useful if they're separate, so a different part of your system can react without polling.

---

## Questions

API behaviour → NEDA Labs engineering. Whether you're authorised to attest, or what the verification standard requires → NEDA Labs compliance, against `NEDA-CDD-REL-2026-01`.
