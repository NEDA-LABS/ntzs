# 09 — WaaS Partner API Reference

**Document owner**: NEDA Labs Limited  
**Last updated**: July 2026  
**Classification**: Regulatory — Bank of Tanzania Sandbox Submission

---

## 1. Overview

The WaaS (Wallet-as-a-Service) API allows licensed partner applications to embed nTZS functionality — wallet provisioning, deposits, withdrawals, swaps, and transfers — under their own brand. Partners authenticate with a bearer token scoped to their sub-wallet namespace.

All endpoints are under `/api/v1/` on the base URL `https://www.ntzs.co.tz`.

### Partner Onboarding Flow

```mermaid
flowchart LR
    A[Partner signs agreement] --> B[NEDA Labs provisions\npartner account + API key]
    B --> C[Partner receives\nBearer token]
    C --> D[Partner calls\nPOST /api/v1/users\nto provision wallets]
    D --> E[Partner users\ncan deposit, swap, withdraw]
```

### Swap Integration Flow

```mermaid
sequenceDiagram
    participant PA as Partner App
    participant API as nTZS API

    PA->>API: GET /swap/rate?from=USDT&to=NTZS&amount=100
    API-->>PA: { expectedOutput, minOutput, expiresAt }
    Note over PA: Show rate to user, wait for confirmation
    PA->>API: POST /swap (SSE stream)
    API-->>PA: SSE: CHECKING → SENDING → FILLING → FILLED
    Note over PA: Display txHash and output amount to user
```

### Supported Operations

| Capability | Endpoint |
|---|---|
| Exchange rate quote | `GET /api/v1/swap/rate` |
| Execute swap | `POST /api/v1/swap` (SSE) |
| Create user + wallet | `POST /api/v1/users` |
| Get user profile + balances | `GET /api/v1/users/:id` |
| Withdrawal quote (name + fees + net) | `POST /api/v1/withdrawals/quote` |
| Execute withdrawal (cash-out) | `POST /api/v1/withdrawals` |
| Recipient name check before withdrawal | `POST /api/v1/lookup/recipient-name` |
| Create org/treasury sub-wallet | `POST /api/v1/partners/sub-wallets` |
| List sub-wallets | `GET /api/v1/partners/sub-wallets` |
| LP pool balances | `GET /api/v1/mm/balances` |
| LP withdraw | `POST /api/v1/mm/withdraw` |
| LP activate/deactivate pool | `PATCH /api/v1/mm/activate` |
| Regenerate API key | `POST /api/v1/partners/regenerate-key` |

---

Partners integrate via a REST + SSE API using a bearer token issued during onboarding. All endpoints are under `/api/v1/`.

---

## What's New — v1.8.0 (23 Jul 2026)

### Instant document verification — no more waiting when the registry has no record

Until now, a user whose NIDA + phone pair had no Tier-A registry record (typically: not a Selcom Pesa customer) was queued for manual review — correct, but slow. They can now finish **instantly** instead: open a capture session with `POST /api/v1/users/:id/kyc/session`, let the user photograph their ID and take a selfie (~2 minutes), and our `kyc.updated` webhook tells you the verdict. The same session verifies non-Tanzanian identity documents (pass `country`) — document verification covers 200+ countries.

**Do you need to update your integration?**

| Scenario | Action required |
|----------|----------------|
| You handle `202 kyc_pending_review` today | **Recommended.** On a `202`, open a session and run the capture flow instead of showing "wait for review". On the `kyc.updated` webhook with `approved`, re-call `POST /api/v1/users` (idempotent) to get the `walletAddress`. |
| Your users hold non-Tanzanian documents | **Partially unlocked.** An existing user can verify a non-TZ document via the session `country` field. NIDA-less user creation (full international signup) ships in the next version. |
| Selcom Tier A verifies your users instantly today | **None.** Nothing changes for them. |

---

## What's New — v1.7.0 (23 Jul 2026)

### Withdrawal quotes — fee & recipient disclosure before money moves

`POST /api/v1/withdrawals/quote` prices a cash-out exactly as execution will and returns the full confirmation-card payload in one call: the recipient's **registered name**, the **fee breakdown** (platform + PSP + total), the **burn amount**, the **net the recipient receives**, balance sufficiency, and a signed **`quoteId`** valid 5 minutes. `POST /api/v1/withdrawals` accepts the `quoteId` and rejects it if the terms changed — so the payer always confirms the current price. See [Withdrawals (Cash-out)](#withdrawals-cash-out).

Your confirmation screen must show, before the user's final tap: *who they are paying (name + number), the fee, and the net amount* — this is a Bank of Tanzania consumer-disclosure requirement, and the quote response contains everything needed to render it.

**Do you need to update your integration?**

| Scenario | Action required |
|----------|----------------|
| You execute withdrawals (cash-out) | **Yes.** Call `/withdrawals/quote` first, render the confirmation card (name, fees, net), then execute with the returned `quoteId`. Direct calls without a `quoteId` keep working during the migration window; **on the announced enforcement date they will fail with `quote_required`**. |
| You use `/api/v1/lookup/recipient-name` before withdrawals | Keep it for non-withdrawal use; for withdrawals the quote endpoint supersedes it (name + fees in one call). |
| You only use swap / rates / deposits | **None.** No changes. |

---

## What's New — v1.6.0 (16 Jul 2026)

### Recipient name lookup before withdrawals

`POST /api/v1/lookup/recipient-name` resolves the registered name behind a mobile money number so your withdrawal confirm screen can show **"Sending to: JOHN DOE"** — catching wrong-number typos before money moves. Fail-soft contract: `name: null` means "no confirmation available", never "invalid recipient" — proceed without the name line, never block. See [Recipient Name Lookup](#recipient-name-lookup).

**Do you need to update your integration?** No — the endpoint is additive and optional (strongly recommended for withdrawal UX).

---

## What's New — v1.5.0 (14 Jul 2026)

### Identity verification (KYC) is now a structural prerequisite for user wallets

Every end-user wallet must be backed by a verified national identity (Bank of Tanzania sandbox, Testing Parameter 8). Verification runs on a risk-tiered ladder — instant for most users, human review for the rest, **no user dead-ends**. See [Identity Verification (KYC)](#identity-verification-kyc) for the full contract.

**Do you need to update your integration?**

| Scenario | Action required |
|----------|----------------|
| You create user wallets | **Yes.** Send `nidaNumber` + `phone` on `POST /api/v1/users`, and handle the new `202 kyc_pending_review` response (show "verification under review", re-call later — the endpoint is idempotent). |
| You have users created before v1.5.0 | **Yes.** They have no identity on file (`kycStatus: "none"` on `GET /api/v1/users/:id`). Prompt them in-app and verify via `POST /api/v1/users/:id/kyc`. Their wallets keep working — verification is additive, nothing is frozen. |
| You want a treasury / business wallet | Complete KYB (business verification) from the partner dashboard — certificate of incorporation upload → compliance review → sub-wallets unlock. |
| You only use swap / rates | **None.** No changes. |

---

## What's New — v1.4.0 (27 Apr 2026)

### USDT is now live on Base and BNB Smart Chain

**Do you need to update your integration?**

| Scenario | Action required |
|----------|----------------|
| You only swap `NTZS ↔ USDC` on Base | **None.** No breaking changes. |
| You want to offer `NTZS ↔ USDT` on Base | Add `"USDT"` as `fromToken` or `toToken` in swap calls. |
| You want cross-chain `USDT (BNB) ↔ nTZS (Base)` | Add `fromChain: "bnb"` or `toChain: "bnb"` to the swap body. |
| You withdraw USDT to BNB Smart Chain | Add `"chain": "bnb"` to the withdraw request body. |

### What changed in the API

**`POST /api/v1/swap`** — `fromToken` / `toToken` now accept `"USDT"`. New optional fields:
```json
{
  "fromToken": "USDT",
  "toToken": "NTZS",
  "fromChain": "bnb",
  "toChain": "base",
  "amount": 50
}
```
Cross-chain swaps use a dual-solver model: the BNB solver handles USDT on BNB; the Base solver handles nTZS on Base. No bridging protocol is involved.

**`GET /api/v1/swap/rate`** — `from`, `to` now accept `"USDT"`. New optional params: `fromChain`, `toChain`.

**`POST /api/v1/mm/withdraw`** — New optional `chain` field. Must be `"bnb"` when withdrawing BNB USDT:
```json
{ "token": "usdt", "chain": "bnb", "toAddress": "0x...", "amount": "100" }
```

**`GET /api/v1/mm/balances`** — Response now includes `"usdt"` field alongside `"ntzs"` and `"usdc"`.

### New token addresses

| Token | Chain | Address | Decimals |
|-------|-------|---------|----------|
| USDT | Base mainnet | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | 6 |
| USDT | BNB Smart Chain | `0x55d398326f99059fF775485246999027B3197955` | 18 |

> **Note on BNB USDT decimals:** BEP-20 USDT uses 18 decimals (unlike Base USDT which uses 6). The API accepts and returns human-readable amounts — this difference is handled server-side. You do not need to adjust your amount formatting.

---

## Authentication

All partner endpoints require:

```
Authorization: Bearer <partner-api-key>
```

API keys are issued per partner and scoped to their sub-wallet namespace. Keys can be rotated via `POST /api/v1/partners/regenerate-key`.

---

## Swap Rate (Public)

### `GET /api/v1/swap/rate`

Returns the current expected output for a swap **without executing it**. No authentication required. Use this before showing a swap UI or confirming an order.

#### Query params

| Param | Required | Description |
|-------|----------|-------------|
| `from` | ✓ | `NTZS`, `USDC`, or `USDT` |
| `to` | ✓ | `NTZS`, `USDC`, or `USDT` |
| `amount` | ✓ | Numeric amount of `from` token |
| `fromChain` | — | `base` or `bnb` (default: `base`) |
| `toChain` | — | `base` or `bnb` (default: `base`) |

#### Example — USDT → nTZS

```
GET /api/v1/swap/rate?from=USDT&to=NTZS&amount=10
```

```json
{
  "from": "USDT",
  "to": "NTZS",
  "amount": 10,
  "midRate": 3750,
  "bidBps": 120,
  "askBps": 150,
  "expectedOutput": 37443.75,
  "minOutput": 37069.31,
  "rate": 3744.375,
  "expiresAt": "2026-04-27T10:00:30.000Z",
  "lowLiquidity": false
}
```

#### Example — cross-chain (USDT on BNB → nTZS on Base)

```
GET /api/v1/swap/rate?from=USDT&to=NTZS&fromChain=bnb&toChain=base&amount=50
```

#### Response fields

| Field | Description |
|-------|-------------|
| `midRate` | Reference market rate (TZS per stablecoin unit) |
| `rate` | Effective rate after LP spread — what the user actually gets per unit |
| `expectedOutput` | Best-case output at current rate |
| `minOutput` | Minimum output including 1% slippage protection |
| `expiresAt` | Rate is good for ~30 seconds — refresh before executing |
| `lowLiquidity` | `true` if solver balance may be insufficient for this amount |

> **Recommended flow:** call `/swap/rate` → show the user `expectedOutput` and `minOutput` → if confirmed, call `POST /api/v1/swap` within the `expiresAt` window using the same `slippageBps`.

---

## Swap

### `POST /api/v1/swap`

Executes a direct LP-pool swap on behalf of a WaaS user. Streams real-time order status as Server-Sent Events (SSE). Requires authentication.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | ✓ | Partner-scoped user ID |
| `fromToken` | `"NTZS" \| "USDC" \| "USDT"` | ✓ | Token being sold |
| `toToken` | `"NTZS" \| "USDC" \| "USDT"` | ✓ | Token being bought (must differ from `fromToken`) |
| `amount` | number | ✓ | Amount of `fromToken` to sell (human units) |
| `fromChain` | `"base" \| "bnb"` | — | Chain of the input token (default: `"base"`) |
| `toChain` | `"base" \| "bnb"` | — | Chain of the output token (default: `"base"`) |
| `slippageBps` | number | — | Slippage tolerance in basis points (default: `100` = 1%) |

#### Supported pairs

| fromToken | toToken | fromChain | toChain | Notes |
|-----------|---------|-----------|---------|-------|
| NTZS | USDC | base | base | nTZS → USDC on Base |
| USDC | NTZS | base | base | USDC → nTZS on Base |
| NTZS | USDT | base | base | nTZS → USDT on Base |
| USDT | NTZS | base | base | USDT (Base) → nTZS |
| USDT | NTZS | bnb | base | USDT (BNB) → nTZS (cross-chain) |
| NTZS | USDT | base | bnb | nTZS → USDT (BNB) (cross-chain) |

Cross-chain swaps use a dual-solver model — no bridging protocol is involved.

#### Response: SSE stream

The response is `Content-Type: text/event-stream`. Each event is a JSON object on a `data:` line:

```
data: {"status":"CHECKING","message":"Checking balance..."}
data: {"status":"SENDING","message":"Sending 100 USDT to liquidity pool...","txHash":"0x..."}
data: {"status":"FILLING","message":"Sending nTZS to your wallet...","txHash":"0x..."}
data: {"status":"FILLED","message":"Swap complete!","txHash":"0x..."}
```

Terminal statuses: `FILLED`, `FAILED`, `PARTIAL_FILL_EXHAUSTED`

#### Error statuses

| `status` | `error` | Meaning |
|----------|---------|---------|
| `FAILED` | `INSUFFICIENT_BALANCE` | User wallet has less than `amount` |
| `FAILED` | `INSUFFICIENT_LIQUIDITY` | Pool cannot cover the output amount |
| `FAILED` | `SLIPPAGE_EXCEEDED` | Price moved beyond `slippageBps` since rate was quoted |
| `FAILED` | `PAIR_NOT_FOUND` | The requested token pair / chain combo is not active |
| `FAILED` | `TX_FAILED` | On-chain transaction reverted |
| `FAILED` | `NO_SIGNER` | Wallet has no signing method configured |

#### Complete integration example

```ts
// Step 1 — fetch rate and show to user
const rateRes = await fetch(
  'https://www.ntzs.co.tz/api/v1/swap/rate?from=USDT&to=NTZS&amount=100'
)
const rate = await rateRes.json()
// Show rate.expectedOutput, rate.minOutput, rate.expiresAt to user

// Step 2 — execute after user confirms
const swapRes = await fetch('https://www.ntzs.co.tz/api/v1/swap', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ntzs_live_xxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId: 'user-uuid',
    fromToken: 'USDT',
    toToken: 'NTZS',
    amount: 100,
    slippageBps: 100,   // 1% — match what you showed the user
  }),
})

// Step 3 — stream SSE events
const reader = swapRes.body!.getReader()
const decoder = new TextDecoder()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  for (const line of decoder.decode(value).split('\n')) {
    if (!line.startsWith('data: ')) continue
    const event = JSON.parse(line.slice(6))
    // { status: 'FILLED', message: 'Swap complete!', txHash: '0x...' }
    if (event.status === 'FILLED' || event.status === 'FAILED') break
  }
}
```

---

## User Wallets

### `POST /api/v1/users`

Creates a new WaaS user, verifies their identity, and provisions a dedicated HD-derived wallet on Base. Idempotent — calling with the same `externalId` returns the existing user.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `externalId` | string | ✓ | Your app's internal user ID — used for idempotency and lookup |
| `email` | string | ✓ | User's email address |
| `nidaNumber` | string | ✓ | User's 20-digit NIDA number (dashes/spaces accepted) |
| `phone` | string | ✓ | User's **own** Tanzanian mobile money number (`07…`, `+2557…`, or `2557…`) — it must be registered in the user's name |
| `name` | string | — | Display name |

#### Response `201 Created` — identity verified instantly, wallet issued

```json
{
  "id": "uuid-assigned-by-ntzs",
  "externalId": "your-app-user-id",
  "email": "user@example.com",
  "name": "Jane Doe",
  "phone": "255712345678",
  "walletAddress": "0xABC123...",
  "balance": 0
}
```

#### Response `202 Accepted` — identity queued for manual review

```json
{
  "id": "uuid-assigned-by-ntzs",
  "externalId": "your-app-user-id",
  "walletAddress": null,
  "kycStatus": "pending_review",
  "code": "kyc_pending_review",
  "message": "We could not verify your identity automatically, so it has been submitted for manual review. ..."
}
```

The user exists but has **no wallet yet**. Show a "verification under review" state (see [UX copy](#suggested-ux-copy)) and re-call this endpoint later — it is idempotent, and once our compliance team approves the review (usually within one business day) the same call returns `walletAddress`. While the review is open, the idempotent response includes `kycStatus: "pending_review"`.

If the `externalId` already exists, returns `200` with the existing record (no duplicate wallet created), including `kycStatus` when the user has no wallet yet.

#### How wallets are derived

Each partner has an encrypted HD seed (auto-generated on first `POST /api/v1/users` call). Every new user claims the next available index from that seed atomically. The derivation is deterministic — the same `externalId` always resolves to the same wallet. New wallets are pre-funded with a small ETH amount for gas automatically.

#### Errors

| Status | `code` | Meaning / what to show the user |
|--------|--------|--------------------------------|
| `400` | — (`externalId and email are required`) | Missing required fields |
| `400` | `kyc_required` | No `nidaNumber` sent — identity is a prerequisite for holding nTZS |
| `400` | `kyc_failed` | NIDA malformed, or the NIDA + phone pair could not be verified — ask the user to check both |
| `400` | `phone_required` | Phone missing or not a valid Tanzanian mobile number |
| `400` | `identity_binding_failed` | The phone is registered to a **different person** than the NIDA — the user must use the mobile money number in their own name |
| `409` | `nida_already_registered` | This NIDA already backs a wallet (or a verification under review) with your platform |
| `503` | `kyc_unavailable` | Verification provider temporarily unreachable — retry later; **do not show this as a rejection** |
| `500` | — | `WAAS_ENCRYPTION_KEY` env var missing on server |

---

### `GET /api/v1/users/:id`

Returns user profile, identity status, and live on-chain token balances. `:id` is the nTZS-assigned UUID returned from `POST /api/v1/users`.

#### Response

```json
{
  "id": "uuid-assigned-by-ntzs",
  "externalId": "your-app-user-id",
  "email": "user@example.com",
  "phone": "255712345678",
  "walletAddress": "0xABC123...",
  "balanceTzs": 1250.0,
  "balanceUsdc": 10.5,
  "balanceUsdt": 0.0,
  "kycStatus": "approved"
}
```

Balances are read live from Base mainnet. `walletAddress` will be `null` if wallet provisioning is still pending.

`kycStatus` is one of `approved`, `pending_review`, `rejected`, or `none`. **`none` means the user was created before the KYC standard and has no identity on file** — prompt them in-app and verify via `POST /api/v1/users/:id/kyc` below. Their wallet keeps working in the meantime; verification is additive.

---

## Identity Verification (KYC)

Every end-user wallet is backed by a verified national identity (BoT sandbox Testing Parameter 8). Verification runs on a **risk-tiered ladder** — you integrate once and never care which tier fired:

| Tier | What happens | Speed |
|------|--------------|-------|
| A | The NIDA + phone pair is verified against a bank-grade KYC registry | instant |
| B | The phone's telco SIM registration (NIDA + fingerprints by law) is used as supporting evidence | instant |
| B′ | No registry record? The user photographs their government ID + takes a selfie with liveness — verified automatically ([session endpoint](#post-apiv1usersidkycsession)) | ~2 minutes |
| C | Our compliance team reviews the case with the collected evidence | usually < 1 business day |

Rules your UX should reflect:

- The phone must be the user's **own** mobile money line (a line registered to someone else is a hard fail — this is deliberate, per AML policy).
- "Under review" is **not** a rejection — never show it as an error. Better: make it an *action* by opening a document-capture session so the user can finish instantly.
- One NIDA backs at most one wallet on your platform.

### `POST /api/v1/users/:id/kyc`

Attaches a verified identity to an **existing** user — for users created before the KYC standard (retro-KYC), and for re-attempts after a rejected review. Never touches the user's wallet or balance; a user whose signup was queued for review gets their wallet issued the moment approval lands here.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `nidaNumber` | string | ✓ | User's 20-digit NIDA number |
| `phone` | string | ✓ | User's own Tanzanian mobile money number |

#### Responses

| Status | Body highlights | Meaning |
|--------|-----------------|---------|
| `200` | `kycStatus: "approved"`, `walletAddress` | Verified instantly (or was already verified — `alreadyVerified: true`) |
| `202` | `kycStatus: "pending_review"` | Queued for manual review (or already under review) — poll `GET /api/v1/users/:id` |
| `400` | `code` as in the create-user error table | Rejected / invalid input |
| `409` | `nida_already_registered` | NIDA belongs to another user on your platform |
| `503` | `kyc_unavailable` | Retry later |

#### Retro-KYC campaign pattern

1. `GET /api/v1/users/:id` for your active users → collect those with `kycStatus: "none"` (or `"rejected"`).
2. Prompt in-app: "Verify your identity to keep your nTZS wallet compliant" + NIDA + phone form.
3. `POST /api/v1/users/:id/kyc` → handle the three outcomes exactly like signup.
4. Nothing is frozen and no deadline is enforced by the API — the campaign is prompt-driven.

### `POST /api/v1/users/:id/kyc/session`

Opens an **instant document-verification session** for an existing user — the fast path out of `pending_review` (users the registry doesn't know), and the verification path for non-Tanzanian identity documents. Never touches wallets or balances.

#### Request body (optional)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `country` | string | — | ISO 3166-1 alpha-2 of the user's identity document (default `TZ`) |

#### Responses

| Status | Body highlights | Meaning |
|--------|-----------------|---------|
| `201` | `caseId`, `session: { token, smilePartnerId, apiBaseUrl, submitPath, partnerParams, callbackUrl, expiresInSeconds }` | Session open — run the capture flow within 15 minutes |
| `200` | `alreadyVerified: true` | Already approved — nothing to do |
| `400` | `invalid_country` | Bad country code |
| `404` | — | User does not belong to your platform |
| `503` | `kyc_unavailable` | Temporarily unavailable — retry shortly |

#### Capture flow

1. **Open the session server-side** (your API key never reaches a browser) and hand the `session` object to your frontend. The `token` is short-lived and safe for the client.
2. **Capture with the device camera**: document **front** photo (back optional where relevant), one **selfie**, and **6–8 liveness frames** (a short burst). On mobile, the SmileID v12 mobile SDKs handle all capture; on web you own the camera UI.
3. **Submit directly from the client to SmileID** — `POST {session.apiBaseUrl}{session.submitPath}` as `multipart/form-data`, headers `SmileID-Partner-ID: {session.smilePartnerId}` + `SmileID-Token: {session.token}`, parts: `country`, `document`, `document_back` (optional), `selfie_image`, `liveness_images` (repeated), plus `user_details`, `consent`, and `partner_params` as **JSON-string parts**. `partner_params` must be exactly `session.partnerParams`; `consent` records the user's explicit agreement: `{ "granted": true, "granted_at": ISO-8601, "notice_language": "EN", "notice_privacy_policy_url": "…" }`.
4. SmileID responds `202 Accepted` — that is an acknowledgement, **not** the verdict.
5. The verdict lands on our platform webhook; we move the case and notify you via the `kyc.updated` partner webhook (signed + retried, configured from your partner dashboard): `{ externalId, kycStatus: "approved" | "rejected" | "pending_review", provider: "smileid" }`.
6. On `approved`, re-call `POST /api/v1/users` (idempotent) — the response now carries `walletAddress`. On `pending_review`, the document needs a human look (expired, glare, photocopy) — usually < 1 business day. On `rejected`, show the reason and allow a fresh attempt with a new session.

Re-calling the endpoint reuses the user's open case with a fresh token, so an abandoned capture can simply be restarted.

### Suggested UX copy

| State | English | Swahili (suggested) |
|-------|---------|---------------------|
| Under review | "Your identity verification is under review — you'll be notified when it completes (usually within one business day)." | "Uthibitisho wa utambulisho wako unakaguliwa — utajulishwa ukikamilika (kwa kawaida ndani ya siku moja ya kazi)." |
| Phone/NIDA mismatch | "This mobile number is not registered to the holder of this NIDA. Use the mobile money number registered in your own name." | "Namba hii ya simu haijasajiliwa kwa jina la mmiliki wa NIDA. Tumia namba ya simu iliyosajiliwa kwa jina lako." |
| Could not verify | "We couldn't verify this NIDA and mobile number together. Check both and try again." | "Hatukuweza kuthibitisha NIDA na namba ya simu kwa pamoja. Hakiki zote mbili kisha ujaribu tena." |
| Service unavailable | "Verification is temporarily unavailable. Please try again shortly." | "Huduma ya uthibitisho haipatikani kwa sasa. Tafadhali jaribu tena baadaye." |

### Business / treasury wallets (KYB)

Sub-wallets and treasury wallets are business wallets: they unlock after **KYB** — upload your certificate of incorporation (and supporting documents) from the partner dashboard; our compliance team reviews maker-checker style. Until approval, sub-wallet creation returns `403 kyb_required`.

### Integration test checklist

1. Create a user with a real NIDA + their own phone → expect `201` + wallet (Tier A) **or** `202 pending_review` (Tier C) — both are success paths.
2. Same NIDA, a phone in someone else's name → expect `400 identity_binding_failed`.
3. Re-call `POST /api/v1/users` with the same `externalId` → expect the idempotent existing-user response.
4. A `202` user: after our team approves the review, re-call → expect `walletAddress` populated.
5. A legacy user: `GET /api/v1/users/:id` → `kycStatus: "none"` → `POST /api/v1/users/:id/kyc` → same outcomes as signup.
6. A `202` user: `POST /api/v1/users/:id/kyc/session` → complete capture with a SmileID sandbox test identity → expect the `kyc.updated` webhook, then `walletAddress` on the create-user re-call.

---

## Recipient Name Lookup

### `POST /api/v1/lookup/recipient-name`

Resolves the mobile-money-registered name for a Tanzanian number so your app can show **"Sending to: JOHN DOE"** on the withdrawal confirm screen.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phoneNumber` | string | ✓ | Recipient mobile money number (`07XXXXXXXX` / `06XXXXXXXX` or `255…`) |

#### Response — `200`

```json
{ "phone": "255689123456", "network": "airtel", "name": "JOHN JOSEPH DOE" }
```

`name` is `null` whenever no verified name is available — number not registered, the enquiry service unavailable, or the capability not yet enabled for the environment.

**The null contract (important):** `null` means "no confirmation available", **not** "invalid recipient". Show your normal confirm screen without the name line and let the withdrawal proceed. Never block or warn on `null`.

#### Other responses

| Status | Meaning |
|--------|---------|
| `400 invalid_phone` | Not a valid Tanzanian mobile number |
| `401` | Bad/missing bearer token |
| `429` | Rate limited (30 lookups/min per partner) — honor `Retry-After` |

#### Suggested UX copy

| State | English | Swahili (suggested) |
|-------|---------|---------------------|
| Name found | "Sending to: {NAME} ({phone}). Confirm?" | "Unamtumia: {NAME} ({phone}). Thibitisha?" |
| Name unavailable | "Confirm the number {phone} is correct before continuing." | "Hakikisha namba {phone} ni sahihi kabla ya kuendelea." |

Lookups are rate-limited and audit-logged: the endpoint resolves registered names (PII) and must only be called from user-initiated withdrawal flows — bulk or speculative querying will trip the limiter and our audit review.

---

## Withdrawals (Cash-out)

Burns the user's nTZS and pays out TZS to their mobile money number. **Two-step flow: quote, then execute.** The quote returns everything your confirmation screen must display — recipient name, fees, and net amount — plus a signed `quoteId` that authorizes execution at exactly those terms.

`amountTzs` in both calls is the amount the recipient should **receive** (net). The burn amount is grossed up server-side: `burn = ceil((receive + pspFee) / (1 − platformFeeRate))`. Minimum receive amount: **5,000 TZS**.

### `POST /api/v1/withdrawals/quote`

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | ✓ | Your user's nTZS user id |
| `amountTzs` | number | ✓ | Amount the recipient should receive (net), ≥ 5000 |
| `phoneNumber` | string | ✓ | Recipient mobile money number (any TZ format) |

#### Response `200 OK`

```json
{
  "quoteId": "eyJ2IjoxLCJw…",
  "expiresAt": "2026-07-23T14:05:00.000Z",
  "expiresInSeconds": 300,
  "recipientPhone": "255744277496",
  "recipientName": "JOHN DOE",
  "receiveAmountTzs": 5000,
  "burnAmountTzs": 6533,
  "fees": { "platformFeeTzs": 33, "pspFeeTzs": 1500, "totalFeeTzs": 1533 },
  "balance": { "availableTzs": 12000, "sufficient": true }
}
```

- `recipientName: null` means the registry had no answer — show the number without a name line, never block (same fail-soft contract as recipient-name lookup).
- `balance.sufficient: false` → `quoteId` is `null`; show the shortfall instead of a confirm button.
- Quotes expire after **5 minutes**; fetch a fresh one if the user dawdles.

#### Required confirmation screen

Before the user's final tap, display: **who they are paying** (name + number), **the fee** (`fees.totalFeeTzs`), and **what the recipient receives** (`receiveAmountTzs`). On success, say "*TZS 5,000 is on its way to JOHN DOE (fees TZS 1,533)*" — never present the gross burn amount as the amount "sent".

### `POST /api/v1/withdrawals`

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | ✓ | Must match the quote |
| `amountTzs` | number | ✓ | Must match the quote (receive-net) |
| `phoneNumber` | string | ✓ | Must match the quote |
| `quoteId` | string | ✓* | From `/withdrawals/quote`. *Optional during the migration window; **mandatory after the announced enforcement date** (`quote_required` otherwise). |

#### Response `201 Created`

```json
{
  "id": "af9fb83f-4ef9-4445-acdf-22ef5b774766",
  "status": "burned",
  "amountTzs": 6533,
  "receiveAmountTzs": 5000,
  "recipientName": "JOHN DOE",
  "platformFeeTzs": 33,
  "pspFeeTzs": 1500,
  "totalFeeTzs": 1533,
  "message": "Withdrawal processed: 5000 TZS on its way to the recipient (1533 TZS in fees)."
}
```

Amounts ≥ 1,000,000 TZS queue for admin approval instead (`status: "requested"`).

#### Errors

| Error | Status | Meaning | UI action |
|-------|--------|---------|-----------|
| `quote_required` | 400 | Enforcement on, no `quoteId` sent | Upgrade to the two-step flow |
| `invalid_quote` | 400 | Expired / malformed / bad signature | Fetch a fresh quote, re-confirm |
| `quote_mismatch` | 400 | user/phone/amount differ from the quote | Fetch a fresh quote |
| `quote_stale` | 409 | Pricing changed since the quote was issued | Fetch a fresh quote, re-confirm the new price |
| `insufficient_balance` | 400 | Balance below burn amount | Show shortfall (`details.available` / `details.required`) |

Payout failures after a successful burn are handled server-side (auto-revert or operator reconciliation); the response's `payoutStatus` and `message` describe the state — surface `message` verbatim when present.

---

## Partner Sub-Wallets (Org Treasury)

Sub-wallets are partner-owned, labeled HD-derived wallets — separate from end-user wallets. Use them for org treasury accounts, escrow, reserves, or any wallet that belongs to the partner entity rather than an individual user.

**Enterprise use case:** when an Enterprise org is approved in backstage, call `POST /api/v1/partners/sub-wallets` with the org name as the label. The returned address becomes the org's treasury wallet for disbursements and repayments.

Sub-wallets derive from a separate HD path (`m/44'/8453'/1'/0/{index}`) so they never collide with user wallets.

### `POST /api/v1/partners/sub-wallets`

Creates a new labeled sub-wallet under the partner's HD seed.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | ✓ | Human-readable name for this wallet, max 50 chars (e.g. `"NEDA Capital Ltd Treasury"`) |

#### Response `201 Created`

```json
{
  "id": "sub-wallet-uuid",
  "label": "NEDA Capital Ltd Treasury",
  "address": "0xDEF456...",
  "walletIndex": 1,
  "derivationPath": "m/44'/8453'/1'/0/1",
  "createdAt": "2026-05-28T10:00:00.000Z"
}
```

#### Errors

| Status | `error` | Cause |
|--------|---------|-------|
| `400` | `label is required` | Missing or blank label |
| `400` | `label must be 50 characters or fewer` | Label too long |
| `400` | `HD wallet seed not configured. Create a user wallet first.` | No user wallets have been created yet for this partner |

---

### `GET /api/v1/partners/sub-wallets`

Lists all sub-wallets provisioned under the partner.

#### Response

```json
{
  "subWallets": [
    {
      "id": "sub-wallet-uuid",
      "label": "NEDA Capital Ltd Treasury",
      "address": "0xDEF456...",
      "walletIndex": 1,
      "createdAt": "2026-05-28T10:00:00.000Z"
    }
  ]
}
```

---

## Multi-Wallet Patterns

### Personal wallet (Consumer)

The standard `POST /api/v1/users` flow. One wallet per user for personal transactions (send, receive, swap).

### Merchant wallet (Biashara)

When a NEDApay user activates Biashara, provision a second wallet scoped to their merchant identity by appending a prefix to the `externalId`:

```ts
// Personal wallet (already exists)
POST /api/v1/users  { externalId: "user_abc123", email: "merchant@example.com" }

// Merchant wallet (provisioned on Biashara activation)
POST /api/v1/users  { externalId: "merchant_abc123", email: "merchant@example.com" }
```

The `merchant_` prefix ensures a distinct HD index and a separate on-chain address. Merchant collections, settlement splits, and lender revenue flows operate on this wallet without touching the user's personal balance.

### Org treasury wallet (Enterprise)

Use the sub-wallets endpoint — not a user wallet. The org is a partner entity, not an individual:

```ts
// On enterprise org approval in backstage
POST /api/v1/partners/sub-wallets  { label: "NEDA Capital Ltd Treasury" }
// → returns treasuryWalletAddress, stored on partners.treasuryWalletAddress
```

---

## Identity Verification & KYC Model

WaaS does not perform identity verification. It is pure wallet infrastructure — it trusts that the calling partner has already completed KYC before requesting wallet provisioning.

**The correct flow:**

```
User signs up on NEDApay/partner app
  → KYC provider API called (identity verified)
  → On approval: POST /api/v1/users
  → WaaS provisions wallet
  → User receives wallet
```

**Regulatory requirement:** Wallet provisioning is only permitted for users who have completed KYC. This is a Bank of Tanzania mandate — `POST /api/v1/users` must never be called for an unverified user. By calling this endpoint, the partner attests that KYC has passed for that individual.

NEDApay owns the user relationship. KYC providers are pluggable vendors — not distribution channels. Users sign up directly with NEDApay; the KYC provider is an API call in the onboarding flow that must complete successfully before wallet provisioning is triggered. If a provider is swapped out, users are unaffected.

**KYC is routed by user type:**

| User | Identity document | Notes |
|------|-------------------|-------|
| Tanzanian resident | NIDA number | Verified via a NIDA-accredited KYC product |
| International user | Passport / national ID from country of origin | Verified via an international KYC provider |

Using a bank's KYC product for NIDA access does not make nTZS dependent on that bank's user base. The bank exposes a verification API — it is a service vendor, not a gatekeeper. If that relationship ends, route Tanzanian users to a different NIDA-accredited provider. No user migration, no WaaS changes.

**Avoiding single-provider lock-in:**

KYC provider routing happens inside NEDApay's onboarding layer, not in WaaS. WaaS only sees the final `POST /api/v1/users` call after KYC passes — completely agnostic to which provider ran the check. Adding or swapping a KYC provider is a NEDApay change, not a WaaS change.

**Implication for feature unlocking:** Biashara and Enterprise features require KYB (business verification) in addition to individual KYC. The same principle applies — KYB is handled by a business verification provider before the partner calls WaaS to provision the relevant wallet (user wallet for Biashara, sub-wallet for Enterprise treasury). WaaS does not gate on KYB status.

---

## Balances

### `GET /api/v1/mm/balances`

Returns the LP account's token balances across all active chains.

```json
{
  "source": "pool",
  "ntzs": "50000.00",
  "usdc": "12500.00",
  "usdt": "8300.00",
  "positions": {
    "ntzs": { "contributed": "50000", "earned": "120.5", "total": "50120.5" },
    "usdc": { "contributed": "12000", "earned": "500",   "total": "12500" },
    "usdt": { "contributed": "8000",  "earned": "300",   "total": "8300" }
  }
}
```

---

## MM Withdraw

### `POST /api/v1/mm/withdraw`

Withdraws tokens from the LP's inventory wallet to any address.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | `"ntzs" \| "usdc" \| "usdt"` | ✓ | Token to withdraw |
| `toAddress` | string | ✓ | Destination EVM address |
| `amount` | string | ✓ | Amount in human units (e.g. `"100.5"`) |
| `chain` | `"base" \| "bnb"` | — | Chain to withdraw from (default: `"base"`) |

For BNB USDT: `{ "token": "usdt", "chain": "bnb", ... }`

#### Response

```json
{ "txHash": "0x...", "status": "confirmed", "chain": "bnb" }
```

---

## Activate / Deactivate LP Pool

### `PATCH /api/v1/mm/activate`

Activates or deactivates the LP's pool position.

#### Request body

```json
{ "isActive": true, "chain": "base" }
```

Activation sweeps all eligible token balances from the LP wallet into the solver pool on the specified chain. Deactivation returns contributed + earned amounts back to the LP wallet.

For BNB USDT liquidity, activate with `"chain": "bnb"` separately.

---

## Token Addresses

| Token | Chain | Address | Decimals |
|-------|-------|---------|----------|
| nTZS | Base | `0xF476BA983DE2F1AD532380630e2CF1D1b8b10688` | 18 |
| USDC | Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| USDT | Base | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | 6 |
| USDT | BNB Smart Chain | `0x55d398326f99059fF775485246999027B3197955` | 18 |

---

## Chain IDs

| Chain | Network | Chain ID |
|-------|---------|----------|
| Base | Mainnet | 8453 |
| BNB Smart Chain | Mainnet | 56 |

---

## Error format

All non-SSE endpoints return errors as:

```json
{ "error": "Human-readable message" }
```

SSE errors are delivered as a terminal event:

```
data: {"status":"FAILED","error":"INSUFFICIENT_LIQUIDITY","message":"Pool cannot cover this amount"}
```
