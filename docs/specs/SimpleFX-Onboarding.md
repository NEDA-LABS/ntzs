# SimpleFX Onboarding & Access — Engineering Spec

**Status:** Draft for engineering pickup · **Version:** 0.1 · [date]
**Context:** Part of the bank-LP rollout (see internal Bank-LP Strategy Memo). Goal: turn the OTP-only sign-in into a full, account-type-aware onboarding with bank-grade access controls — **without rebuilding the SimpleFX engine.**

---

## 1. Goals

1. A guided **onboarding journey** (not just "log in with OTP"), with a real **sign-up**.
2. **Account types** that branch the flow: `standard` (crypto-native LP, ~today) and `bank` (concierge, KYB, maker-checker).
3. **Maker-checker** (segregation of duties) for banks: one user sets/initiates, another approves.
4. **KYB** document capture + ops review.
5. **Banking/reserve + FX** configuration as explicit, gated steps.
6. Reuse OTP, the session layer, and the dashboard engine. New work is the org/member model, KYB, approvals, and the wizard UI.

## 2. Current state (what exists today)

- Auth: OTP (`lib/fx/otp.ts`, `api/auth/{request-otp,verify-otp}`), session = `{ lpId }` (`lib/fx/auth.ts`: `createSession`/`verifySession`/`getSessionFromCookies`).
- `lp_accounts` is **both the org and the user**: `email` is unique on the row; `onboardingStep int default 1`; `kycStatus ∈ {pending,approved,rejected}`; `bidBps/askBps`; `isActive`; `apiKeyHash`.
- Onboarding = a single integer bumped by `PATCH /api/lp/onboarding` (`{ step }`). No type, members, roles, KYB docs, banking details, or approvals.

## 3. Target model

### 3.1 Organisation ↔ members (the key change)

Split the conflated row: `lp_accounts` becomes the **organisation**; a new `lp_members` table holds the **users** (one org → many members). OTP resolves a *member* by email → their `lpId` + `role`.

```
lp_accounts (org)               # extend existing
  + accountType  enum('standard','bank')  default 'standard'
  + legalName    text
  + status       enum('onboarding','active','suspended') default 'onboarding'
  + kybStatus    enum('not_started','submitted','approved','rejected') default 'not_started'   # org-level KYB (kycStatus stays for back-compat / per-member KYC if needed)
  + bankingProfile jsonb        # trust account ref, bank name, SWIFT, settlement instructions
  + limits        jsonb         # maxInventory per token, perTxnCap, etc.
  (email/displayName stay for back-compat; new accounts may leave email null and use members)

lp_members (NEW)
  id          uuid pk
  lpId        uuid fk -> lp_accounts
  email       varchar(320) unique
  role        enum('owner','operator','approver','viewer')
  status      enum('invited','active','disabled') default 'active'
  invitedBy   uuid null
  createdAt / updatedAt

lp_kyb_documents (NEW)
  id, lpId fk, docType text (license|ownership_ubo|aml_policy|signatory_id|other),
  fileRef text (storage key/url), status enum('submitted','approved','rejected'),
  reviewedBy text null, notes text null, createdAt/updatedAt

lp_approvals (NEW)            # maker-checker
  id, lpId fk, action text (set_fx|withdraw|update_banking|go_live|invite_member|...),
  payload jsonb, requestedBy uuid (member), status enum('pending','approved','rejected'),
  decidedBy uuid null, decidedAt timestamptz null, createdAt
```

Migration is **additive** (new tables + nullable columns); back-fill: each existing `lp_account` gets one `lp_member` (role `owner`, its current email), `accountType='standard'`, `status` from `isActive`.

### 3.2 Auth / session changes

- Keep OTP as the primitive. The OTP table is keyed by email → now matches a `lp_members.email`.
- Session payload grows: `{ lpId, memberId, role }` (extend `createSession`/`verifySession`). All `session.lpId` call-sites keep working; new gating reads `session.role`.
- **Sign-up** (new): `POST /api/lp/auth/signup` → creates the org + first member (`owner`) + sends OTP. Existing verify-otp logs the member in.
- **Invite**: owner/admin invites operator/approver by email → `lp_members(status='invited')` → invitee verifies via OTP to activate.

## 4. Onboarding flows (step machines, driven by `onboardingStep`)

Keep the integer cursor; define the step set per `accountType` in a shared registry (`lib/fx/onboarding.ts`) so the wizard is data-driven. `GET /api/lp/onboarding` returns `{ accountType, step, steps[], blockers[] }`.

### 4.1 Standard LP (≈ today, lightly guided)
1. Sign up + OTP → 2. Profile (display name) → 3. Light KYC (optional/deferred) → 4. Set spread → 5. Fund wallet / activate → **active**.

### 4.2 Bank partner (concierge)
1. **Sign up + OTP** → create org (`accountType='bank'`, legal name).
2. **KYB** — upload licence, ownership/UBO, AML policy, authorised signatories (`lp_kyb_documents`).
3. **Team** — invite **operator** + **approver** (maker-checker), assign roles.
4. **Banking & reserve** — trust/escrow account details (`bankingProfile`); confirm reserve-dashboard access.
5. **FX configuration** — spread + exposure limits (maker sets → **approver authorises** via `lp_approvals`).
6. **Sandbox test** — guided small/sandbox transaction; watch the fill, the statement, and a settle-back.
7. **Go-live** — NEDA ops review (KYB approved + steps complete) → `status='active'`.

Steps 2 and 7 gate on **ops/backstage** approval; steps 4–5 gate on **approver** sign-off when maker-checker is on.

## 5. Roles & permissions (maker-checker matrix)

| Capability | owner | operator (maker) | approver (checker) | viewer |
|---|---|---|---|---|
| View dashboard / statements | ✓ | ✓ | ✓ | ✓ |
| Set FX / spread / limits | ✓* | ✓* | — | — |
| Initiate withdraw / settlement | ✓* | ✓* | — | — |
| **Approve** a pending request | ✓ | — | ✓ | — |
| Invite / manage members | ✓ | — | — | — |
| Edit banking profile | ✓* | ✓* | — | — |

`*` When maker-checker is enabled (default ON for `bank`, OFF for `standard`), starred actions create an `lp_approvals` row and execute **only after** an approver approves. A maker cannot approve their own request.

## 6. API surface

- `POST /api/lp/auth/signup` — create org + owner member; send OTP.
- `request-otp` / `verify-otp` — unchanged, now resolve a member.
- `GET /api/lp/onboarding` · `PATCH /api/lp/onboarding` — extend existing PATCH to **validate step transitions** per type + return state.
- `POST /api/lp/members/invite` · `POST /api/lp/members/accept` · `GET /api/lp/members`.
- `POST /api/lp/kyb/documents` (presigned upload) · `GET /api/lp/kyb/documents`.
- `PUT /api/lp/banking` · `PUT /api/lp/fx` (creates an approval when maker-checker on).
- `GET /api/lp/approvals` · `POST /api/lp/approvals/[id]/{approve,reject}`.
- `POST /api/lp/golive` (ops-gated).
- Backstage: `GET/POST /api/backstage/simplefx/[lpId]/kyb` (approve/reject docs), go-live review. (Extend existing `backstage/simplefx`.)

## 7. UI / screens

- Extend `_components/sign-in-flow-1.tsx` → add a **sign-up** entry + account-type choice.
- New **onboarding wizard** shell under `dashboard/onboarding/` with one component per step; progress from `onboardingStep`.
- **Team** settings page (members + roles + invite).
- **KYB upload** screens (drag-drop → presigned upload → status).
- **Banking** + **FX config** screens (FX shows pending-approval state).
- **Approvals inbox** (approver sees pending maker requests).
- Backstage KYB review + go-live screen.

## 8. Reuse vs new

**Reuse:** OTP, session layer, dashboard shell + positions/spread/transactions pages, `fx-pool-reconcile` (becomes the reserve dashboard), `onboardingStep`, `kycStatus`, backstage/simplefx.
**New:** `lp_members` / `lp_kyb_documents` / `lp_approvals` tables + the org/member split, KYB upload + review, maker-checker approvals + invite flow, banking profile, the onboarding wizard UI, account-type branching, file storage for KYB.

## 9. Build order (phased)

- **Phase A (MVP, ships with bank-LP Phase 1):** account types + the data-driven onboarding wizard (uses existing single-user model) + KYB upload + ops review + banking/FX steps + go-live gate. Maker-checker can be stubbed (single owner).
- **Phase B:** full `lp_members`/roles + maker-checker approvals + invite flow + role-gated UI.
- **Phase C (later):** SSO/2FA beyond OTP, IP allowlisting, scoped API keys per member.

## 10. Open questions

1. **KYB file storage** — which bucket/service (S3-compatible? existing upload infra)? Retention + access controls.
2. Does **standard** onboarding change, or only the bank path is added? (Recommend: keep standard light, add the bank branch.)
3. Should `kycStatus` be repurposed as org KYB, or add `kybStatus` (spec assumes a new `kybStatus`, leaving `kycStatus` for back-compat)?
4. Where ops live for KYB review + go-live — extend `backstage/simplefx`.
5. Do we need per-member **KYC** in addition to org **KYB** for banks (named signatories)?
