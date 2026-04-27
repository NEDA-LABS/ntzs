# WaaS Partner API Reference

Partners integrate via a REST + SSE API using a bearer token issued during onboarding. All endpoints are under `/api/v1/`.

---

## Authentication

All partner endpoints require:

```
Authorization: Bearer <partner-api-key>
```

API keys are issued per partner and scoped to their sub-wallet namespace. Keys can be rotated via `POST /api/v1/partners/regenerate-key`.

---

## Swap

### `POST /api/v1/swap`

Executes a direct LP-pool swap on behalf of a WaaS user. Streams real-time order status as Server-Sent Events (SSE).

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
| USDT | NTZS | bnb | base | USDT (BNB) → nTZS on Base (cross-chain) |
| NTZS | USDT | base | bnb | nTZS → USDT (BNB) (cross-chain) |

Cross-chain swaps use a dual-solver model: the BNB solver receives/sends USDT on BNB Smart Chain; the Base solver handles nTZS on Base. No bridging protocol is involved.

#### Response: SSE stream

The response is `Content-Type: text/event-stream`. Each event is a JSON object:

```
data: {"status":"CHECKING","message":"Checking balance..."}
data: {"status":"SENDING","message":"Sending 100 USDT to liquidity pool...","txHash":"0x..."}
data: {"status":"FILLING","message":"Sending nTZS to your wallet...","txHash":"0x..."}
data: {"status":"FILLED","message":"Swap complete!","txHash":"0x..."}
```

Terminal statuses: `FILLED`, `FAILED`, `PARTIAL_FILL_EXHAUSTED`

#### Error statuses

| status | error code | Meaning |
|--------|-----------|---------|
| `FAILED` | `INSUFFICIENT_BALANCE` | User wallet has less than `amount` |
| `FAILED` | `INSUFFICIENT_LIQUIDITY` | Pool cannot cover the output |
| `FAILED` | `TX_FAILED` | On-chain transaction reverted |
| `FAILED` | `NO_SIGNER` | Wallet has no signing method configured |

---

## Swap Rate

### `GET /api/v1/swap/rate`

Returns the current expected output for a swap without executing it. Public endpoint — no authentication required.

#### Query params

| Param | Description |
|-------|-------------|
| `from` | `NTZS`, `USDC`, or `USDT` |
| `to` | `NTZS`, `USDC`, or `USDT` |
| `amount` | Numeric amount of `from` token |

#### Response

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
  "expiresAt": "2024-01-01T00:00:30.000Z",
  "lowLiquidity": false
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

All non-SSE endpoints return errors as plain text (4xx/5xx) or:

```json
{ "error": "Human-readable message" }
```
