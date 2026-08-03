# 09 — WaaS Partner API Reference

**Document owner**: NEDA Labs Limited  
**Last updated**: August 2026  
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
| Initiate deposit (mobile money / card / Lipa Namba / bank transfer) | `POST /api/v1/deposits` |
| Deposit status | `GET /api/v1/deposits/:id` |
| Withdrawal quote (name + fees + net) | `POST /api/v1/withdrawals/quote` |
| Execute withdrawal (cash-out) | `POST /api/v1/withdrawals` |
| Recipient name check before withdrawal | `POST /api/v1/lookup/recipient-name` |
| Merchant / TANQR / biller name check before payment | `POST /api/v1/lookup/merchant-name` |
| Create org/treasury sub-wallet | `POST /api/v1/partners/sub-wallets` |
| List sub-wallets | `GET /api/v1/partners/sub-wallets` |
| Ramp: settlement float address + USDC balance | `GET /api/v1/ramp/balance` |
| Ramp: price USDC ⇄ TZS | `POST /api/v1/ramp/quote` |
| Ramp: execute off-ramp (USDC → TZS payout) | `POST /api/v1/ramp/offramp` |
| Ramp: execute on-ramp (TZS → USDC) | `POST /api/v1/ramp/onramp` |
| Ramp: settlement status | `GET /api/v1/ramp/:id` |
| Ramp: list settlements | `GET /api/v1/ramp/settlements` |
| LP pool balances | `GET /api/v1/mm/balances` |
| LP withdraw | `POST /api/v1/mm/withdraw` |
| LP activate/deactivate pool | `PATCH /api/v1/mm/activate` |
| Regenerate API key | `POST /api/v1/partners/regenerate-key` |

---

Partners integrate via a REST + SSE API using a bearer token issued during onboarding. All endpoints are under `/api/v1/`.

---

## What's New — v1.17.0 (3 Aug 2026)

**Deposits can now arrive by bank transfer.** `POST /api/v1/deposits` accepts `paymentMethod: "bank_transfer"` — no phone number. The response carries a generated **reference** (e.g. `NTZ-7K2M9Q`) and an `instructions` block (institution, account number, account name, exact amount, ready-to-show note): your user sends a bank transfer (TIPS, from any Tanzanian bank) to that account with the reference in the transfer description, and nTZS mints automatically once the credit appears on our settlement account — typically within ~10 minutes.

- **Matching is reference + exact amount.** Both must be right, or the payment is held for manual review instead of auto-crediting — funds are never lost, but the flow stalls on a human. Make the reference and the exact figure impossible to miss in your UI.
- The reference is valid for **72 hours** from intent creation, and `GET /api/v1/deposits/:id` echoes it while the deposit is still open, so payment details can be re-shown without storing them.
- Method availability is flagged server-side: while the rail is off, the endpoint answers `400` with `bank_transfer deposits are not enabled`.
- Test keys accept the same request and return the same shapes (including a real-format reference), so the integration is buildable end-to-end in sandbox.

---

## What's New — v1.16.0 (3 Aug 2026)

**Withdrawals can now pay bank accounts.** `POST /api/v1/withdrawals/quote` and `POST /api/v1/withdrawals` accept `bankCode` + `accountNumber` as the destination instead of `phoneNumber` — same quote→confirm contract, and the quote returns the **registered account holder's name** so your user confirms who they're paying, exactly like wallets. Fees follow the same Selcom tariff (a 500,000 TZS bank payout carries the same 1,250 TZS PSP fee as a wallet one). The signed quote binds the bank destination — execution can only pay the confirmed account. Codes come from the canonical FI table in the withdrawals section (pass `CRDB`, never "CRDB Bank"). Bank rails are Selcom-only for now (`503 bank_rail_unavailable` when off; `400 bank_amount_unsupported` at ≥ 1,000,000 TZS gross), and the sandbox accepts the same fields with the same validation, so build against your test key first.

---

## What's New — v1.15.3 (3 Aug 2026)

**Off-ramp executes now answer in ~10 seconds.** The synchronous chain that produced 40–50s calls (awaited fee-mint confirmations, a 21s payout-status poll, slow chain polling) is gone: the on-chain value capture is still fully confirmed before any fiat dispatches, but everything best-effort now runs without holding your connection. You get `201 completed` when the PSP settles fast, else `202 paying_out` — completion lands on the `ramp.settlement.completed` webhook and `GET /api/v1/ramp/:id`. Never re-execute on a `202`.

---

## What's New — v1.15.2 (3 Aug 2026)

**Failed payouts refund themselves.** A definitively failed off-ramp reverts and returns its full gross to your settlement address as nTZS; `GET /api/v1/ramp/balance` now shows that value (`ntzsBalance` + note), and your **next off-ramp consumes it automatically before any USDC is debited** — re-quote and execute, and the original intent completes with no double conversion cost. The `ramp.settlement.failed` webhook has always named the return address (`returnedAsNtzsTo`); now the balance surface and the engine close the loop.

---

## What's New — v1.15.1 (3 Aug 2026)

**Off-ramp quotes in local currency.** `POST /api/v1/ramp/quote` with `direction: "offramp"` now accepts **either** `usdcAmount` (as before) **or** `tzsAmount` — the exact net TZS your user asked for. Quote by `tzsAmount` when your users think in shillings: the recipient receives exactly that figure, and the response's `usdcAmount` is what your settlement float will be debited. Pass exactly one of the two; execution is unchanged (consume the `quoteId` as before).

---

## What's New — v1.15.0 (1 Aug 2026)

**Withdrawals now cost what the serving rail costs — usually much less.** The PSP fee in withdrawal quotes was a flat 1,500 TZS; it now follows the rail that will actually carry the payout (`payoutRail` on the quote). On the current primary rail a 5,000 TZS withdrawal carries a **150 TZS** PSP fee — display the quote's `fees`, never hardcoded figures. A rail change between quote and execute answers `409 quote_stale`; re-quote and re-confirm.

- **User-facing payout confirmation.** `POST /api/v1/withdrawals` and `GET /api/v1/withdrawals/:id` now return `payoutRail`, `payoutReference`, `payoutReceipt` (the rail's own receipt number when available) and a ready-to-show `confirmationMessage` ("TZS 5,000 sent to JOHN DOE (2557…) via Selcom — ref …"). **Push or display this to your user on completion** — the rail's own confirmation SMS goes only to the platform's corporate account, so without it your user never sees a receipt.
- The status GET also returns `receiveAmountTzs` and `recipientPhone`, so completion notifications need no client-side fee math.

---

## What's New — v1.14.0 (31 Jul 2026)

**The Ramp API is now documented, and the sandbox caps bind on it.** Partners settling cross-border USDC ⇄ TZS get the full reference below — including **how to fund your settlement float** (`GET /api/v1/ramp/balance` returns your dedicated deposit address; native USDC on Base only).

- **Merchant & bill off-ramp destinations** (`destination.kind: "lipa" | "bill"`) are enabled for **supervised testing** under our regulatory sandbox. The recipient's registered name is disclosed on the quote; the destination is bound to it.
- **Regulatory sandbox limits now apply to ramp settlements**: 1,000,000 TZS per transaction, and 2,000,000 TZS per day / 60,000,000 TZS per 30 days **per recipient wallet** — each till, bill account or mobile wallet you pay has its own allowance (the payer's wallet, for on-ramps), so paying many different merchants is not throttled. Exceeding a limit returns `400` with `per_txn_cap` / `daily_user_cap` / `monthly_user_cap` and current usage — see the Ramp section's limits table. We are formally engaging the Bank of Tanzania on scaling these parameters.

---

## What's New — v1.13.0 (30 Jul 2026)

**Never pay twice, and always get your token.** Three changes born from a real production incident (a LUKU purchase whose response was lost in transport — the client showed a failure, the user retried, and paid twice):

- **`GET /api/v1/spend/:id`** — retrieve a spend's status **and its settlement**, including the utility `utilityToken` / `utilityUnits` for bill purchases. After any ambiguous `POST /api/v1/spend` outcome (network error, timeout), **poll this — never retry the POST.**
- **`409 duplicate_spend`** — an identical payment (same wallet, same destination, same amount) within **5 minutes** of one still in flight or completed is refused, and the response carries the original transaction *with its token*. Show the user their existing payment. To repeat deliberately, resend with `"allowDuplicate": true`.
- **Utility vouchers in every surface** — the LUKU/utility token now rides the `201` response when settlement is fast, the `spend.updated` webhook, and the GET. For a bill purchase the token **is** the product; treat a completed bill payment without showing the token as a broken flow.

Also: test-mode bill spends now settle with a deterministic `utilityToken`, so you can build and assert on the token-display path with a test key.

---

## What's New — v1.12.0 (27 Jul 2026)

### Biashara is now a partner capability — embed a merchant product in your app

`/api/v1/biashara/*` (merchant activation, payment links & QR, sales, settlement, cash-out and
working capital) now accepts a **standard partner API key** with the `biashara` capability, not
only our internal service key. A partner can embed the whole merchant product under their own UI —
a bank's merchant tab, for instance — while holding no wallet, no key and no float.

**Tenant isolation:** a partner key can only see merchants it created. Another tenant's merchant id
returns `404`, never `403`, so the API does not confirm it exists. Merchants created through the
first-party service key are invisible to every partner key.

Not simulated in test mode (`501`) — the merchant rails run against live providers, so the
meaningful test is a small real payment. See [docs/partners/biashara.md](partners/biashara.md).

---

## What's New — v1.11.0 (27 Jul 2026)

### Test mode — build the whole integration before a shilling moves

Every partner endpoint now has a **sandbox twin**. Get credentials in seconds from `POST /api/v1/testmode/signup` (no contract, no waiting), point your integration at the `ntzs_test_` key, and the same endpoints return the same shapes against **simulated money, simulated identity and simulated payment providers**.

What is *real* in test mode: the fee maths (the same functions production charges with), quote signing and expiry, every validation rule and error code, and webhooks — really delivered, really signed, carrying `livemode: false`. What is simulated: the blockchain, the PSPs and the identity registry.

Deterministic scenarios let you exercise the unhappy paths on demand — **the last two digits decide the outcome**: `…13` fails and reverts, `…02` lands in `reconcile_required`, `…99` stays pending forever, `…00` has no registered name, and a NIDA ending `0000` triggers the manual-review branch. See [Test Mode](#test-mode).

Test data lives in its own tables. It is not, and cannot become, part of nTZS supply, the reserve, or any attestation.

---

## What's New — v1.10.0 (25 Jul 2026)

### Spend — pay any Lipa Namba or bill in Tanzania with nTZS

Your users can now **spend** their nTZS directly: `POST /api/v1/spend/quote` + `POST /api/v1/spend` burn the user's balance and pay a **merchant Lipa Namba on any network** (M-Pesa, Tigo, Airtel, Selcom tills) or a **biller** — LUKU electricity, GEPG government control numbers, DSTV/AzamTV/StarTimes, water utilities, airtime and more. Settlement is typically seconds, failures auto-revert the burn, and the quote returns the destination's **registered name** (merchant tills and bill accounts alike — a LUKU meter number resolves to its registered customer before the user pays). Spend is **quote-first by design**: execution always requires a `quoteId`, so every user sees who they're paying and the exact fees before money moves. See [Spend (Pay Merchants & Bills)](#spend-pay-merchants--bills).

> Rollout: the endpoints return `503 spend_disabled` until the rails are switched on for your environment — integrate now, flip later with no code change.

---

## What's New — v1.9.0 (23 Jul 2026)

### International signups + no more dead-ends

`POST /api/v1/users` now accepts a `country` field (ISO 3166-1 alpha-2, default `TZ`). For any country other than TZ, `nidaNumber` is **not** required: the user is created immediately with a pending document-verification case, and the capture session (see [Identity Verification](#identity-verification-kyc)) verifies their passport / national ID — 200+ countries covered. The `202` response now carries `nextStep: "kyc_session"`.

Two more changes in the same spirit:

- **Rejected signups soft-land.** A NIDA + phone pair that fails the registry/telco checks no longer returns `400` at signup — the user is created `pending_review` and finishes by document capture. A human still reviews any case with a standing telco contradiction; nothing auto-approves over one.
- **Document uniqueness enforced at the verdict.** One document identity backs at most one user per partner — the document-flow equivalent of the NIDA dedupe, applied at the moment the ID number is first known (extraction).

**Do you need to update your integration?** No — all changes are additive. To onboard non-Tanzanian users, send `country` and omit `nidaNumber`; everything after the `202` is the flow you already built.

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

Keys are **mode-scoped**. A key beginning `ntzs_live_` moves real money; a key beginning `ntzs_test_` is served entirely by the sandbox described below. There is no per-request flag and no way to mix the two — the key decides.

---

## Test Mode

Test mode is the sandbox partners integrate against before go-live. It is the **same API surface** — same paths, same request bodies, same response shapes, same error codes — running against simulated money.

### Getting credentials

```http
POST /api/v1/testmode/signup
Content-Type: application/json

{ "name": "Acme Bank", "email": "dev@acme.co.tz", "webhookUrl": "https://acme.co.tz/hooks/ntzs" }
```

```json
{
  "livemode": false,
  "partnerId": "…",
  "apiKey": "ntzs_test_…",
  "webhookSecret": "whsec_…"
}
```

No contract, no account review, no waiting. Existing partners can instead issue a paired test key from the developer dashboard (**Settings → Test key**) — it is a separate sandbox account, so rotating it never affects the live key.

### What is real, and what is not

| Real in test mode | Simulated |
| --- | --- |
| Fee maths — the same functions production charges with | The blockchain (deterministic fake addresses and tx hashes) |
| Quote signing, expiry, `quote_mismatch`, `quote_stale` | The payment providers (no PSP is ever called) |
| Every validation rule and error code | The identity registry (no NIDA lookup) |
| Webhooks — delivered, HMAC-signed, retried | Balances (held in `test_mode_*` tables) |

Test-mode webhook payloads carry `livemode: false`; live ones carry `livemode: true`.

### Scenarios — the last two digits decide the outcome

For a **deposit** the digits come from the amount; for anything that **pays out** (withdrawal phone, Lipa till, bill reference) they come from the destination.

| Trigger | Result |
| --- | --- |
| ends in `13` | Fails. A payout burns, fails, and reverts — the balance comes back. |
| ends in `02` | `reconcile_required` — burned, unconfirmed, **not** refunded. Exercise your "do not retry" path. |
| ends in `99` | Stays `pending` forever. Test timeouts and stuck-transaction handling. |
| ends in `00` | No registered name — render the unverified-destination warning. |
| Lipa till `61115582` / `70031820` | Resolves to `ENZI COFFEE COMPANY LIMITED` / `NEDA LABS LIMITED`. |
| NIDA ending `0000` | `202 kyc_pending_review` — the manual-review branch. |
| anything else | Completes. |

### Controls

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/testmode` | Mode, scenarios, controls, recent transactions, and **which rails are live in production**. |
| `POST /api/v1/testmode/advance` | Settle every due transaction now instead of waiting (~3s by default). Use this in CI. |
| `POST /api/v1/testmode/users/:id/approve` | Clear a simulated manual KYC review and fire `kyc.updated`. |
| `POST /api/v1/testmode/reset` | Delete every simulated user and transaction on this key. |

### Two deliberate differences

1. **Test mode runs every rail**, including capabilities not yet switched on in production — so you can build ahead of a rollout. `GET /api/v1/testmode` reports what is actually live; check it before committing to a launch date.
2. **Ramp and Swap are not simulated** (`501 not_available_in_test_mode`). Both settle against live counterparties, so there is no honest way to fake them — verify with small live amounts instead (see the Ramp section, including its sandbox limits).

### Isolation

Test-mode activity is written to dedicated tables and is never read by nTZS supply, the reserve, or any attestation. Simulated balances are not liabilities and cannot appear in a regulatory report — the isolation is structural, not a filter.

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
  "spreadBps": 150,
  "tzsBuyRate": 3693.75,
  "tzsSellRate": 3795.0,
  "protocolFeeBps": 20,
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
| `spreadBps` | The quoted LP's spread applied to THIS direction (ask when buying nTZS, bid when selling) |
| `tzsBuyRate` | The LP's board rate when the user BUYS nTZS: nTZS received per 1 stablecoin (mid − ask spread) |
| `tzsSellRate` | The LP's board rate when the user SELLS nTZS: nTZS paid per 1 stablecoin (mid + bid spread) |
| `protocolFeeBps` | Platform fee charged on top of the LP spread (already inside `rate`/`expectedOutput`) |
| `rate` | Effective rate after LP spread AND platform fee — what the user actually gets per unit |
| `expectedOutput` | Best-case output at current rate |
| `minOutput` | Minimum output including 1% slippage protection |
| `expiresAt` | Rate is good for ~30 seconds — refresh before executing |
| `lowLiquidity` | `true` if solver balance may be insufficient for this amount |

> **Recommended flow:** call `/swap/rate` → show the user `expectedOutput` and `minOutput` → if confirmed, call `POST /api/v1/swap` within the `expiresAt` window using the same `slippageBps`.

> **Rate transparency (v1.15.0):** the quote is priced off the **same LP the swap would execute against** (best spread among LPs whose pooled inventory covers your size), so `tzsBuyRate`/`tzsSellRate`/`spreadBps` are exactly the rates your user swaps at — render them next to the amount (e.g. "Rate: 1 USD = 3,693.75 TZS · LP spread 1.50% · platform fee 0.20%"). If no LP can cover the size, `lowLiquidity` is `true` and execution would refuse.

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
| `nidaNumber` | string | ✓ (TZ) | User's 20-digit NIDA number (dashes/spaces accepted). Omit when `country` ≠ `TZ` |
| `phone` | string | ✓ (TZ) | User's **own** Tanzanian mobile money number (`07…`, `+2557…`, or `2557…`) — must be registered in the user's name. Optional E.164 for non-TZ signups |
| `country` | string | — | ISO 3166-1 alpha-2 of the user's identity (default `TZ`). Non-TZ signups skip the NIDA ladder and verify by document capture |
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

- The phone must be the user's **own** mobile money line. A line registered to someone else no longer hard-fails signup — the user soft-lands into document verification — but a standing telco contradiction always puts a human reviewer in the loop before approval (deliberate, per AML policy: nothing auto-approves over a contradiction).
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
| `country` | string | — | ISO 3166-1 alpha-2 of the user's identity document. Defaults to the user's open case country (international signups carry theirs), then `TZ` |

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

## Merchant Name Lookup

### `POST /api/v1/lookup/merchant-name`

Resolves the **registered trading name** behind a merchant Lipa Namba — including a **TANQR** scan, which resolves to one — or a bill account, so your app can show **"Paying: KARIAKOO HARDWARE LIMITED"** on the confirmation screen.

**Why this is separate from the quote.** `/v1/spend/quote` and `/v1/ramp/quote` already return this name, but a quote is a priced, single-use, expiring commitment and a scan is not: a user points a camera at a QR long before choosing an amount. Use this endpoint at scan time, then quote once they have entered the amount.

**Available regardless of which payment rails are enabled for you.** It resolves a name; it moves no money. You can build and test your confirmation screen before a rail is switched on.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | string | ✓ | `lipa` (merchant till / TANQR) or `bill` (biller account) |
| `payNumber` | string | `lipa` | Merchant Lipa Namba, 4–12 digits |
| `utilityCode` | string | `bill` | Biller code — see `GET /api/v1/spend/billers` |
| `utilityRef` | string | `bill` | Meter / control / smartcard number |
| `amountTzs` | number | – | `bill` only: intended purchase amount. Biller validation is amount-aware (LUKU requires ≥ 1,000 TZS); defaults to 1,000 when omitted. Send the real amount when you have it. |

#### Response — `200`

```json
{ "kind": "lipa", "target": "lipa:61115582", "payNumber": "61115582", "name": "ENZI COFFEE COMPANY LIMITED" }
```

```json
{ "kind": "bill", "target": "bill:LUKU:01234567890", "utilityCode": "LUKU", "utilityRef": "01234567890", "name": null, "reason": "not_found" }
```

**The null contract is the same as the recipient lookup:** `name: null` means "no confirmation available", not "invalid merchant". Show the raw number with a caution and let the user proceed. `reason` distinguishes an unregistered destination from an enquiry service that is temporarily down.

A **malformed** request is still an error — an unknown `utilityCode` is a bug in the caller, not an unverifiable merchant.

#### Other responses

| Status | Meaning |
|--------|---------|
| `400` | `payNumber` not 4–12 digits, `unknown_biller`, or `invalid_utility_ref` |
| `401` | Bad/missing bearer token |
| `429` | Rate limited (60 lookups/min per partner) — honor `Retry-After` |

#### Test mode

Test keys return deterministic **trading** names with no PSP call and no quota. A destination ending `00` resolves to `name: null`, so you can build the "we could not verify this merchant" branch without hunting for an unregistered till.

Lookups are rate-limited and audit-logged. Trading names are less sensitive than personal ones, but this endpoint must not be used to enumerate the national till directory.

---

## Withdrawals (Cash-out)

Burns the user's nTZS and pays out TZS to their mobile money number. **Two-step flow: quote, then execute.** The quote returns everything your confirmation screen must display — recipient name, fees, and net amount — plus a signed `quoteId` that authorizes execution at exactly those terms.

`amountTzs` in both calls is the amount the recipient should **receive** (net). The burn amount is grossed up server-side: `burn = ceil((receive + pspFee) / (1 − platformFeeRate))`. Minimum receive amount: **5,000 TZS**.

**The PSP fee follows the rail that will serve the payout** — it is not a flat constant. The quote's `payoutRail` names the rail it priced (e.g. `selcom`, whose published tariff is amount-tiered: 150 TZS at a 5,000 payout; `snippe` is a flat 1,500). Always display the quote's `fees` — never hardcode fee figures. If the serving rail changes between quote and execute, the execute call answers `409 quote_stale` and you re-quote at the current price.

### `POST /api/v1/withdrawals/quote`

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | ✓ | Your user's nTZS user id |
| `amountTzs` | number | ✓ | Amount the recipient should receive (net), ≥ 5000 |
| `phoneNumber` | string | ✓* | Recipient mobile money number (any TZ format) |
| `bankCode` | string | ✓* | Bank payout instead of mobile money: a canonical FI code from the table below |
| `accountNumber` | string | ✓* | Bank account (digits; CRDB accepts alphanumeric) — always with `bankCode` |

\* Exactly one destination: `phoneNumber` **or** `bankCode` + `accountNumber`. Bank quotes return the **registered account holder's name** (`recipientName`) just like wallets — show it before the user confirms; a bank quote answers `bankCode` / `bankName` / `accountNumber` instead of `recipientPhone`, and `payoutRail` is always `selcom`.

#### Response `200 OK`

```json
{
  "quoteId": "eyJ2IjoxLCJw…",
  "expiresAt": "2026-07-23T14:05:00.000Z",
  "expiresInSeconds": 300,
  "recipientPhone": "255744277496",
  "recipientName": "JOHN DOE",
  "receiveAmountTzs": 5000,
  "burnAmountTzs": 5206,
  "payoutRail": "selcom",
  "fees": { "platformFeeTzs": 26, "pspFeeTzs": 150, "nedaFeeTzs": 30, "totalFeeTzs": 206 },
  "balance": { "availableTzs": 12000, "sufficient": true }
}
```

- `recipientName: null` means the registry had no answer — show the number without a name line, never block (same fail-soft contract as recipient-name lookup).
- `balance.sufficient: false` → `quoteId` is `null`; show the shortfall instead of a confirm button.
- Quotes expire after **5 minutes**; fetch a fresh one if the user dawdles.

#### Required confirmation screen

Before the user's final tap, display: **who they are paying** (name + number), **the fee** (`fees.totalFeeTzs`), and **what the recipient receives** (`receiveAmountTzs`). On success, say "*TZS 5,000 is on its way to JOHN DOE (fees TZS 206)*" — never present the gross burn amount as the amount "sent".

### `POST /api/v1/withdrawals`

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | ✓ | Must match the quote |
| `amountTzs` | number | ✓ | Must match the quote (receive-net) |
| `phoneNumber` | string | ✓* | Must match the quote (wallet payouts) |
| `bankCode` + `accountNumber` | string | ✓* | Must match the quote exactly (bank payouts) — the signed quote binds the destination |
| `quoteId` | string | ✓** | From `/withdrawals/quote`. **Optional during the migration window; **mandatory after the announced enforcement date** (`quote_required` otherwise). |

\* Exactly one destination, the same one the quote was issued for.

**Bank payouts** ride Selcom only (single-rail — no failover bank rail exists yet): when the rail is off you get a clean `503 bank_rail_unavailable` before any money moves. Bank withdrawals whose **gross** reaches 1,000,000 TZS answer `400 bank_amount_unsupported` for now — split into smaller withdrawals. Everything else is identical to wallets: same fees table (Selcom's send-money tariff covers banks and wallets alike), same sandbox caps, same `confirmationMessage` / `payoutReference` on completion, same refund semantics on failure.

Canonical bank FI codes (pass the **code**, never a bank name): `ABSA`, `BANCABC` (Access), `ACB` (Akiba), `AMANA`, `AZANIA`, `BOA`, `BOBTZ` (Baroda), `BOI`, `BOT`†, `CANARA`, `CITI`, `CRDB`‡, `DCB`, `DTB`, `ECOBANK`, `EQUITY`, `EXIM`, `FINCA`, `GTBANK`, `HABIB`, `IMBANK`, `ICB`, `KCB`, `LETSHEGO`, `MAENDELEO`, `MKOMBOZI`, `MUCOBA`, `MWALIMU`, `MWANGA`, `NBC`, `NCBA`, `NMB`, `PBZ`, `STANBIC`, `SCB` (Standard Chartered), `TCB`, `UCHUMI`, `UBA`.
† name lookup unavailable · ‡ alphanumeric account references

#### Response `201 Created`

```json
{
  "id": "af9fb83f-4ef9-4445-acdf-22ef5b774766",
  "status": "burned",
  "amountTzs": 5206,
  "receiveAmountTzs": 5000,
  "recipientName": "JOHN DOE",
  "platformFeeTzs": 26,
  "pspFeeTzs": 150,
  "totalFeeTzs": 206,
  "payoutRail": "selcom",
  "payoutReference": "16437765-f972-49c4-9231-74f09d815298",
  "payoutReceipt": "SB0801XXXXX",
  "payoutStatus": "completed",
  "confirmationMessage": "TZS 5,000 sent to JOHN DOE (255744277496) via Selcom — ref 16437765-f972-49c4-9231-74f09d815298, receipt SB0801XXXXX.",
  "message": "Withdrawal processed: 5000 TZS on its way to the recipient (206 TZS in fees)."
}
```

**Notify your user with `confirmationMessage`.** The PSP's own confirmation SMS goes only to the platform's corporate account — this field carries the same substance (who was paid, how much, which rail, the reference) ready to show or push verbatim. `payoutReceipt` is the rail's own receipt number when the rail returns one (Selcom does); `payoutStatus` may still be `pending` if the payout is settling — `GET /api/v1/withdrawals/:id` returns the same fields (plus `confirmationMessage` once completed) for your status polling and completion notification.

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

## Spend (Pay Merchants & Bills)

Burns the user's nTZS and pays a **merchant Lipa Namba** (any network — M-Pesa, Tigo, Airtel, Selcom tills) or a **biller** (LUKU electricity, GEPG government control numbers, DSTV/AzamTV, water, airtime and more) directly from the reserve. Settlement is typically seconds.

**Quote-first by design.** Unlike withdrawals (where quote enforcement was phased in), `POST /api/v1/spend` **always requires a `quoteId`** — there is no un-quoted path. The quote returns the destination's registered name and the full fee breakdown; your confirmation screen must show both before executing.

`amountTzs` in both calls is the **principal** — what the till or biller receives. The burn is `principal + selcomFee + platformFee` (no gross-up division; fees are additive).

Fees follow Selcom's published tariffs by destination type: Lipa payments use the Lipa/TanQR table (e.g. 30 TZS on a 1,000 payment), and bill fees vary by biller group — **government payments (GEPG, DAWASA, NHC, Traffic Fine, Tarura, water bills) are FREE up to 20,000 TZS**, while commercial billers like LUKU use a cheaper commercial tier (12 TZS on 1,000). The `fees` object also carries `nedaFeeTzs` — the nTZS network fee (≈0.3%, min 30 TZS) — already included in `totalFeeTzs` and `burnAmountTzs`. The quote always returns the exact fees — display `totalFeeTzs`, never hardcode it.

> Availability: these endpoints return `503 spend_disabled` / `spend_kind_disabled` until the rails are enabled for the environment. Minimum principal: **500 TZS**.

### `POST /api/v1/spend/quote`

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | ✓ | Your user's nTZS user id |
| `kind` | string | ✓ | `lipa` (merchant till) or `bill` (biller) |
| `amountTzs` | number | ✓ | Principal the destination receives, ≥ 500 |
| `payNumber` | string | lipa | Merchant Lipa Namba (4–12 digits) |
| `network` | string | – | Optional network hint — leave unset unless instructed |
| `utilityCode` | string | bill | Biller code, e.g. `LUKU`, `GEPG`, `DSTV`, `TOP` (airtime). Unknown codes return `unknown_biller` with the full `supportedCodes` list |
| `utilityRef` | string | bill | The reference at the biller (meter / control / smartcard number) — validated against the biller's format before any lookup |

#### Response `200 OK`

```json
{
  "quoteId": "eyJ2IjoxLCJr…",
  "expiresAt": "2026-07-25T14:05:00.000Z",
  "expiresInSeconds": 300,
  "kind": "lipa",
  "target": { "payNumber": "61115582", "network": null },
  "recipientName": "ENZI COFFEE COMPANY LIMITED",
  "principalTzs": 1000,
  "burnAmountTzs": 1035,
  "fees": { "selcomFeeTzs": 30, "platformFeeTzs": 5, "nedaFeeTzs": 30, "totalFeeTzs": 65 },
  "balance": { "availableTzs": 12000, "sufficient": true }
}
```

`recipientName` is the destination's **registered name** (merchant tills and most bill accounts — e.g. a LUKU meter resolves to its registered customer). When the registry has no answer, `recipientName` is `null` and `nameUnavailableReason` explains why — show the raw number with an "unverified destination" warning. `quoteId` is omitted when `balance.sufficient` is `false`.

### `POST /api/v1/spend`

Execute at the quoted terms. Send the **same** destination fields plus the `quoteId`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | ✓ | Same user the quote was issued for |
| `quoteId` | string | ✓ | From the quote — **always required** |
| `kind`, `amountTzs`, `payNumber` / `utilityCode` + `utilityRef`, `network` | | ✓ | Must match the quoted terms exactly |

#### Response `201 Created`

```json
{
  "id": "b3f1…",
  "status": "burned",
  "payoutStatus": "completed",
  "reference": "202607259999",
  "kind": "lipa",
  "target": { "payNumber": "61115582", "network": null },
  "recipientName": "ENZI COFFEE COMPANY LIMITED",
  "principalTzs": 1000,
  "burnAmountTzs": 1035,
  "fees": { "selcomFeeTzs": 30, "platformFeeTzs": 5, "nedaFeeTzs": 30, "totalFeeTzs": 65 }
}
```

`payoutStatus` is usually `completed` within the response (settlement measured at ~4s) or `pending` — pending spends settle server-side within a minute and failures **auto-revert the burn** (the user's balance is restored; no partner action needed).

#### Errors

| Error | Status | Meaning | UI action |
|-------|--------|---------|-----------|
| `quote_required` | 400 | No `quoteId` sent | Always fetch a quote first — spend has no un-quoted path |
| `invalid_quote` | 400 | Expired / malformed / bad signature | Fetch a fresh quote, re-confirm |
| `quote_mismatch` | 400 | user/destination/amount differ from the quote | Fetch a fresh quote |
| `quote_stale` | 409 | Pricing changed since the quote was issued | Fetch a fresh quote, re-confirm the new price |
| `unknown_biller` | 400 | `utilityCode` not in the catalogue | Offer the codes from `supportedCodes` |
| `invalid_utility_ref` | 400 | Reference fails the biller's format | Surface `message` (e.g. "Meter No must be exactly 11 digits") |
| `insufficient_balance` | 400 | Balance below burn amount | Show shortfall |
| `amount_too_large` | 400 | Burn total ≥ 1,000,000 TZS | Route the user to support |
| `spend_disabled` / `spend_kind_disabled` | 503 | Rail not enabled on this environment | Hide the feature |
| `duplicate_spend` | 409 | Identical payment made moments ago and still holding funds | Show `existing` (it carries the token where we have it); resend with `"allowDuplicate": true` only on the user's explicit say-so |

#### Ambiguous outcomes — the rule that prevents double payment

If the POST times out or the connection drops, **the payment may still have succeeded.** Never re-POST on a network failure. Call `GET /api/v1/spend/:id` (you have the id only if the response arrived) or simply re-attempt the POST **without** `allowDuplicate`: if the first attempt landed, the 409 hands you its reference, status and token.

### `GET /api/v1/spend/:id`

Status + settlement of a spend. For bill purchases the settlement includes the voucher:

```json
{
  "id": "b3f1…",
  "status": "burned",
  "payoutStatus": "completed",
  "reference": "202607301258",
  "kind": "bill",
  "target": { "utilityCode": "LUKU", "utilityRef": "24219217817" },
  "recipientName": "CHRISTINA R. MWANJALI",
  "principalTzs": 1000,
  "burnAmountTzs": 1047,
  "utilityToken": "5373 0001 9365 2741 2169",
  "utilityUnits": "2.8kWh",
  "selcomReceipt": "SB1234ABCD",
  "actualChargesTzs": 47
}
```

`utilityToken` is `null` until Selcom reports settlement (typically seconds; poll on `payoutStatus: "pending"`). **Display it prominently and persist it on your side** — it is what the customer types into their meter.

---

## Ramp (USDC ⇄ TZS)

Cross-border settlement rails for partners holding USDC. **Off-ramp**: your USDC → a recipient paid in Tanzanian shillings (mobile-money wallet, merchant Lipa Namba, or biller). **On-ramp**: a payer's TZS (mobile money) → USDC delivered on Base. In both directions the recipient side never touches a digital asset — merchants and billers are paid plain TZS into accounts they already hold.

> **Live only.** The Ramp API is **not simulated in test mode** — a test key gets `501 not_available_in_test_mode`. Both directions settle against live counterparties (a real DEX swap, a real PSP payout), so there is no honest way to fake them. Use a **live key** with the `ramp` capability and approved KYB. Build your screens against the domestic Spend test mode (same destination shapes, same name-lookup), then verify the ramp itself with small live amounts.

### Your settlement float

Every ramp partner gets a **dedicated settlement wallet on Base**. You pre-fund it with USDC; off-ramps debit it, on-ramps credit it, so with two-way volume it partially self-replenishes. The float is **your segregated property** — it is not part of the nTZS reserve and never appears in our attestation.

#### `GET /api/v1/ramp/balance`

```json
{
  "settlementAddress": "0xYourDedicatedAddress…",
  "chain": "base",
  "token": { "symbol": "USDC", "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "decimals": 6 },
  "usdcBalance": 1250.5,
  "ntzsBalance": "0"
}
```

**What happens when a payout fails — refunds.** If an off-ramp's fiat leg fails definitively, the settlement returns `status: "reverted"` and **no value is lost**: the full gross is returned to your `settlementAddress` — as **nTZS**, since the USDC→nTZS conversion had already executed. That value shows up in `ntzsBalance` (with an explanatory `note`), and your **next off-ramp consumes it automatically before any USDC is debited** — so a simple re-quote + execute completes the original intent with no double conversion cost. The `ramp.settlement.failed` webhook carries `returnedAsNtzsTo` with the address. If a failure is ambiguous rather than definitive, the settlement holds for operator reconciliation instead of reverting — never retry an ambiguous settlement; check `GET /api/v1/ramp/:id` first.

**Funding it:**

1. Call `GET /api/v1/ramp/balance` with your live key — the `settlementAddress` is yours alone and never changes.
2. Send **native USDC on Base** (token contract above) to that address. Nothing else: no USDbC, no bridged variants, no other chains — tokens sent on the wrong chain or wrong contract are not recoverable by us.
3. **Send a small test amount first** (e.g. 10 USDC), confirm it appears in `usdcBalance`, then fund your working float.
4. Re-check `usdcBalance` before large off-ramps — an off-ramp larger than the float fails cleanly before any money moves.

### Quote → execute

Ramp is quote-first, like Spend. A quote is **single-use, expires in 60 seconds**, and is bound to the destination it priced. Execute consumes it atomically — a quote can never pay out twice.

#### `POST /api/v1/ramp/quote`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `direction` | string | ✓ | `offramp` (USDC → TZS) or `onramp` (TZS → USDC) |
| `usdcAmount` | number | offramp* | USDC you will spend |
| `tzsAmount` | number | offramp* / onramp | **Off-ramp:** the exact net TZS the recipient must receive (≥ 5,000) — we answer with the `usdcAmount` to debit. **On-ramp:** TZS to collect from the payer (≥ 5,000) |
| `destination` | object | – | Off-ramp only. Omit for a mobile-money wallet payout. `{ "kind": "lipa", "payNumber": "…" }` pays a merchant till; `{ "kind": "bill", "utilityCode": "LUKU", "utilityRef": "…" }` pays a biller |

\* For an off-ramp pass **exactly one** of `usdcAmount` or `tzsAmount`. When your user asks in local currency — "pay 50,000 TZS" — quote by `tzsAmount`: the recipient receives **exactly** that figure (fee tiers are absorbed into `feeTzs`, never into the recipient's net), and the response's `usdcAmount` is what your float will be debited on execute.

```json
{
  "quoteId": "7c0e…",
  "direction": "offramp",
  "usdcAmount": 40,
  "tzsAmount": 101300,
  "feeTzs": 2450,
  "rateUsdTzs": 2593.75,
  "destination": { "kind": "lipa", "payNumber": "61115582", "network": null },
  "recipientName": "ENZI COFFEE COMPANY LIMITED",
  "expiresAt": "2026-07-31T10:05:00.000Z"
}
```

For an off-ramp, `tzsAmount` is the **net the recipient receives** after `feeTzs`. For an on-ramp, `tzsAmount` is what the payer pays and `usdcAmount` is what you receive. For lipa/bill destinations the response carries the destination's **registered name** — show it on your confirmation screen; the off-ramp executes exactly the destination the quote priced.

#### `POST /api/v1/ramp/offramp`

Body: `{ "quoteId": "…", "phoneNumber": "07…" }`. `phoneNumber` is required for a wallet payout and ignored for lipa/bill (the destination is bound to the quote). Send an `Idempotency-Key` header — retries with the same key return the original settlement instead of paying twice.

**Latency model.** The call returns as soon as the settlement reaches a definitive state — typically ~10 seconds: `201 completed` when the PSP settles within the short inline window, otherwise `202 paying_out` with the money already captured and the payout dispatched. Treat `202` as success-in-flight, not an error: completion arrives on the `ramp.settlement.completed` webhook (or `ramp.settlement.failed` with the refund semantics above), and `GET /api/v1/ramp/:id` reflects it. Do NOT re-execute on a `202` — the settlement is running.

Responses: `201` settled (`status: "completed"`), `202` payout in flight (`status: "paying_out"` — poll `GET /api/v1/ramp/:id`), `502` failed and **auto-reverted** (`status: "reverted"` — your USDC is back in the float; safe to retry).

#### `POST /api/v1/ramp/onramp`

Body: `{ "quoteId": "…", "phoneNumber": "07…", "destinationAddress": "0x…?" }`. The payer's phone receives a mobile-money prompt; once paid, USDC is delivered to `destinationAddress` (optional) or credited to your settlement float. Responds `202` with `status: "minting"`; track via `GET /api/v1/ramp/:id`. Idempotent via `Idempotency-Key`.

#### `GET /api/v1/ramp/:id` and `GET /api/v1/ramp/settlements?limit=&offset=`

One settlement, or your newest-first list. Statuses: `processing` → `swapping` → `paying_out` → `completed` (off-ramp) and `minting` → `swapping` → `completed` (on-ramp); terminal failures are `failed` or `reverted` (off-ramp reverts return the USDC to your float).

### Regulatory sandbox limits

nTZS operates in the Bank of Tanzania regulatory sandbox. The approved testing parameters are **per-wallet** limits, and on the ramp the wallet is the Tanzanian-side counterparty: the till, bill account or mobile wallet receiving an off-ramp (or the payer's mobile wallet, for an on-ramp). Each counterparty has its **own** daily and 30-day allowance — paying many different merchants is not throttled — and one counterparty's allowance is shared across every partner and both directions (the gross TZS leg of each settlement):

| Limit | Value | Error code |
|-------|-------|------------|
| Per transaction | 1,000,000 TZS | `per_txn_cap` |
| Per day, per recipient / payer wallet | 2,000,000 TZS | `daily_user_cap` |
| Per 30 days, per recipient / payer wallet | 60,000,000 TZS | `monthly_user_cap` |

A request over a limit returns `400` with the cap, the amount you requested, and that wallet's usage in the period:

```json
{
  "error": "daily_user_cap",
  "message": "This transaction would exceed this till's daily sandbox limit of TZS 2,000,000. Used today: TZS 1,850,000.",
  "details": { "limit": 2000000, "requested": 500000, "usedInPeriod": 1850000 }
}
```

Lipa/bill destinations are checked at quote time (the destination is bound to the quote); wallet off-ramps and on-ramps are checked at execute, when the phone number is known — always before any money moves. Failed and reverted settlements do not count against usage. These are regulator-approved testing parameters, not commercial terms — we are formally engaging the Bank of Tanzania on scaling them, and partner volume evidence helps that case.

### Errors specific to ramp

| Error | Status | Meaning |
|-------|--------|---------|
| `not_available_in_test_mode` | 501 | Ramp needs a live key — see the note at the top of this section |
| `ramp_capability_required` / KYB errors | 403 | Your live key lacks the `ramp` capability or KYB is not approved — contact us |
| `ramp_not_provisioned` | 503 | Your settlement wallet is not provisioned yet — contact us; do not send funds until `/ramp/balance` returns your address |
| `ramp_unavailable` | 502/503 | Internal error, nothing charged — the body carries a `requestId`; quote it to us and we can trace the exact failure |
| `ramp_spend_disabled` | 503 | Lipa/bill off-ramp destinations are switched off in this environment (wallet payouts unaffected) |
| Quote consumed / expired | 409 | The quote was already used, expired (60 s), or is for the other direction — fetch a fresh quote |
| `per_txn_cap` / `daily_user_cap` / `monthly_user_cap` | 400 | Sandbox limit — see table above |

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
