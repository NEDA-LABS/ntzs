# Agent float (SmartWakala) — one digital float, every rail

**Audience:** platforms serving mobile-money agents (wakalas)
**Status:** requires the `wakala` capability + approved KYB · gated by
`WAKALA_FLOAT_ENABLED` · **sandbox limits apply per agent — read the Limits section first**

## What this unlocks

Give each of your agents **one nTZS float** that pays out to any destination in
Tanzania from a single balance:

- any **mobile wallet** (M-Pesa, Mixx, Airtel Money, Halopesa)
- any **Lipa Namba** — merchant tills on every network
- any **biller** — LUKU, GEPG control numbers, DAWASA and other water utilities,
  DSTV/AzamTV/StarTimes, airtime

The agent tops the float up once; you disburse from it as often as you like.
No per-network float placement, no counterparty to find, no waiting on a master
agent.

You set the retail price. Our fee is your cost of goods — your margin is
configured on your partner account and mints to your treasury automatically.

## What this is *not*

Be clear-eyed about where the value is, because it decides what you charge for.

Moving float between networks is already free and instant via TIPS. **We do not
compete with that, and you should not price as though we do.** What an agent
cannot do today is take a LUKU payment, a GEPG bill, a bank transfer or an
any-network till payment out of a single balance. Those are transactions they
currently turn away — new commission, not cheaper commission.

For reference, a working wakala earns roughly **322 TZS** on a 50,000 cash-out
and **295 TZS** on a 50,000 cash-in. Our fee on a 50,000 disbursement is
**700 TZS** at zero platform margin. So per-transaction intermediation of an
existing MNO flow does not work — the economics only work on transactions that
do not exist for the agent today, or at larger disbursement sizes (0.55% at
500,000, 0.34% at 5,000,000).

## The model

```
Rakoli-style platform  =  partner (API key)
Each agent             =  one partner sub-wallet
The agent's float      =  that sub-wallet's nTZS balance
```

### 1. Provision an agent float

```
POST /api/v1/partners/sub-wallets
{ "label": "Agent 042 — Kariakoo" }
→ { "id": "…", "address": "0x…", "label": "…" }
```

Keep the returned `id` against your agent record — it is the `subWalletId` for
everything below.

### 2. Fund it

Top up via your existing collection flow, then disburse. The float is an
ordinary nTZS balance; `GET /api/v1/partners/sub-wallets` returns it.

### 3. Disburse — the same endpoints, funded from the float

Pass `subWalletId` **instead of** `userId`. Everything else is unchanged, so if
you have already integrated spend or withdrawals there is nothing new to learn.

```jsonc
// Pay a bill (LUKU, GEPG, water, TV…)
POST /api/v1/spend/quote
{ "subWalletId": "…", "kind": "bill",
  "amountTzs": 20000, "utilityCode": "LUKU", "utilityRef": "01234567890" }
POST /api/v1/spend        { …same…, "quoteId": "…" }

// Pay a merchant till on any network
POST /api/v1/spend/quote  { "subWalletId": "…", "kind": "lipa",
                            "amountTzs": 5000, "payNumber": "61115582" }

// Pay out to a customer's mobile wallet
POST /api/v1/withdrawals/quote
{ "subWalletId": "…", "amountTzs": 50000, "phoneNumber": "0744277496" }
POST /api/v1/withdrawals  { …same…, "quoteId": "…" }
```

Quotes are **bound to the float they were priced for** — a quote issued for one
agent cannot execute against another. Spend always requires a `quoteId`.

Failures revert to the float, never to a user wallet.

## ⚠ Limits — read this before planning a rollout

nTZS operates under a Bank of Tanzania regulatory sandbox, and **each agent
float is treated exactly as one participant**:

| Limit | Value |
| --- | --- |
| Per transaction | 1,000,000 TZS |
| Per float, per day | 2,000,000 TZS |
| Per float, 30 days | 60,000,000 TZS |
| Participants total | 100 |

A second sub-wallet is **another participant**, not extra headroom — we count
disbursements per float deliberately, so agent volume cannot be sharded around
the caps.

A busy wakala turns over more than 2,000,000 in a day, so **these limits do not
yet support production agent volume.** Phase one is a named pilot cohort. The
evidence that cohort produces is what supports a request to raise the
parameters for an agent participant class — which is the path we are on, and
which we would rather walk with you than around you.

Limit responses are structured so your app can render them properly:

```json
{ "error": "daily_user_cap",
  "message": "This transaction would exceed the float's daily limit …",
  "details": { "limit": 2000000, "requested": 60000, "usedInPeriod": 1980000 } }
```

Show "agent limit reached — resets at midnight", not a generic failure.

## Errors

| Code | Meaning |
| --- | --- |
| `403 capability_required` | `wakala` not enabled on your account |
| `503 wakala_float_disabled` | Not switched on for this environment yet |
| `404 Sub-wallet not found` | Unknown id, **or not yours** |
| `400 treasury_not_provisioned` | Set up your partner treasury first |
| `daily_user_cap` / `monthly_user_cap` / `per_txn_cap` | Sandbox limits — see above |
| `409 quote_stale` | Pricing moved since the quote; re-quote |
| `400 quote_mismatch` | Quote was issued for a different float, destination or amount |

## Testing

Unlike Biashara, this **is** covered by test mode. Get a sandbox key from
`POST /api/v1/testmode/signup` and build the entire agent experience against
simulated floats before any money moves — then swap one key.
