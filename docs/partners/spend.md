# Spend — pay merchants & bills with nTZS

**Audience:** NEDApay app team (and all WaaS partners)
**Status:** live now for merchant Lipa payments · bill payments enable per environment · quote is **always** required

## What this unlocks

Your users can spend their nTZS directly: pay a **merchant Lipa Namba on any network** (M-Pesa,
Tigo, Airtel, Selcom tills) or a **biller** — LUKU electricity, GEPG government control numbers,
DSTV/AzamTV, water utilities, airtime and more — straight from their balance. We burn the nTZS and
the reserve pays the destination. Settlement is usually seconds.

No new credentials: your existing API key, user mapping, fee percent and limits all apply. If you
already built the withdrawal quote card, this is the same shape with different fields.

## The flow (quote → confirm → execute)

### 1. Get a quote

```
POST /api/v1/spend/quote
Authorization: Bearer <partner api key>

// Merchant till:
{ "userId": "...", "kind": "lipa", "amountTzs": 1000, "payNumber": "61115582" }

// Bill:
{ "userId": "...", "kind": "bill", "amountTzs": 1000,
  "utilityCode": "LUKU", "utilityRef": "01234567890" }
```

Response:

```json
{
  "quoteId": "eyJ2IjoxLCJrIjoic3BlbmQi...",   // null when balance is insufficient
  "expiresAt": "2026-07-25T14:05:00.000Z",     // 5-minute validity
  "kind": "lipa",
  "recipientName": "ENZI COFFEE COMPANY LIMITED",
  "principalTzs": 1000,
  "burnAmountTzs": 1035,
  "fees": { "selcomFeeTzs": 30, "platformFeeTzs": 5, "totalFeeTzs": 35 },
  "balance": { "availableTzs": 25000, "sufficient": true }
}
```

`amountTzs` is always the **principal** — what the destination receives. The user's balance is
debited `burnAmountTzs` (principal + fees).

### 2. Show the confirmation screen (required)

Before the user's final tap, display:

- **Who they are paying** — `recipientName` (+ the number). If `recipientName` is `null`, show the
  raw number with an "unverified destination" caution.
- **The fee** — `fees.totalFeeTzs`.
- **The total burned** — `burnAmountTzs`.

This is a Bank of Tanzania consumer-disclosure requirement, and the reason the quote step exists.

### 3. Execute

```
POST /api/v1/spend
Authorization: Bearer <partner api key>
{ "userId": "...", "kind": "lipa", "amountTzs": 1000,
  "payNumber": "61115582", "quoteId": "<from step 1>" }
```

`quoteId` is **always required** — there is no un-quoted spend path. The fields must match the
quote or you get `quote_mismatch` / `quote_stale`.

Response `201`:

```json
{ "id": "...", "status": "burned", "payoutStatus": "completed",
  "reference": "202607259999", "recipientName": "ENZI COFFEE COMPANY LIMITED",
  "principalTzs": 1000, "fees": { "totalFeeTzs": 35 },
  "message": "Payment of 1000 TZS dispatched to ENZI COFFEE COMPANY LIMITED (35 TZS in fees)." }
```

`payoutStatus` is usually `completed` in the response. If it is `pending`, it settles server-side
within a minute — and **a failed payment auto-reverts the burn** (the user's balance is restored;
you never handle a stuck state). Subscribe to the `spend.updated` webhook to hear the terminal
state (`completed` | `reverted` | `reconcile_required`).

## Biller catalogue

Render your bill picker from live data, never a hardcoded list:

```
GET /api/v1/spend/billers
Authorization: Bearer <partner api key>
```

Returns billers grouped by category, each with its `referenceLabel` (e.g. "Meter No"), format
rules, and a `feeFreeUnder20k` flag. **Government bills (GEPG, DAWASA, NHC, Traffic Fine, water
bills) are free up to 20,000 TZS** — worth surfacing.

## Test recipe

1. Start with a real merchant till you can verify (a shop's Lipa Namba, or your own).
2. Quote 1,000 TZS → confirm the name comes back → execute.
3. The merchant's phone gets the Selcom Pay notification; `reference` matches their receipt.
4. Then try a bill: `LUKU` with a meter number you know, or a free `GEPG` control number.

## Errors

| Error | Status | Meaning | Action |
|-------|--------|---------|--------|
| `quote_required` | 400 | No `quoteId` | Always quote first |
| `invalid_quote` | 400 | Expired (>5 min) / malformed | Fetch a fresh quote |
| `quote_mismatch` | 400 | Fields differ from the quote | Fetch a fresh quote |
| `quote_stale` | 409 | Pricing changed | Fetch a fresh quote, re-confirm |
| `unknown_biller` | 400 | `utilityCode` not supported | Offer `supportedCodes` |
| `invalid_utility_ref` | 400 | Reference fails the biller format | Surface `message` |
| `insufficient_balance` | 400 | Balance below burn total | Show the shortfall |
| `amount_too_large` | 400 | Burn ≥ 1,000,000 TZS | Route to support |
| `spend_disabled` / `spend_kind_disabled` | 503 | Rail not enabled here yet | Hide the feature |

## Questions

Reach us on the shared channel. Full reference: the **Spend** section of the WaaS Partner API docs
(and the live developer portal at `/developers`).
