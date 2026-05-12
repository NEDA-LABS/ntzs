# 09 — WaaS Partner API Reference

**Document owner**: NEDA Labs Limited  
**Last updated**: May 2026  
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
| Get user profile | `GET /api/v1/users/:id` |
| List sub-wallets | `GET /api/v1/partners/sub-wallets` |
| LP pool balances | `GET /api/v1/mm/balances` |
| LP withdraw | `POST /api/v1/mm/withdraw` |
| LP activate/deactivate pool | `PATCH /api/v1/mm/activate` |
| Regenerate API key | `POST /api/v1/partners/regenerate-key` |

---

Partners integrate via a REST + SSE API using a bearer token issued during onboarding. All endpoints are under `/api/v1/`.

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

## Wallets

### `GET /api/v1/partners/sub-wallets`

Lists all sub-wallets provisioned under the partner's HD seed.

### `POST /api/v1/users`

Creates a new WaaS user and provisions their wallet.

### `GET /api/v1/users/:id`

Returns user profile and wallet address.

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
