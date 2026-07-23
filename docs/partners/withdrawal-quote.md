# Withdrawal quotes — required integration change

**Audience:** NEDApay app team (and all WaaS partners executing withdrawals)
**Status:** quote endpoint live now · `quoteId` becomes **mandatory** on a date we will announce (env-gated)

## Why

Cash-out screens today show neither the recipient's registered name nor the fees, and the
success screen reports the gross amount as "sent" — the recipient actually receives the net.
Regulator consumer-disclosure expectations (BoT sandbox) require the payer to see **who they
are paying, the fee, and the net amount** before authorizing. The API now enforces that
contract.

## The flow (two calls instead of one)

### 1. Get a quote

```
POST /api/v1/withdrawals/quote
Authorization: Bearer <partner api key>
{ "userId": "...", "amountTzs": 5000, "phoneNumber": "0744277496" }
```

Response:

```json
{
  "quoteId": "eyJ2IjoxLCJwYXJ0bmVySWQiOiJ...",     // null when balance is insufficient
  "expiresAt": "2026-07-24T10:05:00.000Z",         // 5-minute validity
  "recipientPhone": "255744277496",
  "recipientName": "JOHN DOE",                     // null when the registry has no answer
  "receiveAmountTzs": 5000,
  "burnAmountTzs": 6533,
  "fees": { "platformFeeTzs": 33, "pspFeeTzs": 1500, "totalFeeTzs": 1533 },
  "balance": { "availableTzs": 12000, "sufficient": true }
}
```

### 2. Show the confirmation card, then execute

The confirmation screen MUST display, before the user's final tap:

> Paying **JOHN DOE** · 0744 277 496
> They receive **TZS 5,000**
> Fees **TZS 1,533** · Total deducted **TZS 6,533**

```
POST /api/v1/withdrawals
{ "userId": "...", "amountTzs": 5000, "phoneNumber": "0744277496",
  "quoteId": "<from step 1>" }
```

`amountTzs`, `phoneNumber` and `userId` must match the quote exactly.

## Error handling

| Error | Meaning | UI action |
|---|---|---|
| `quote_required` | Enforcement is on and no quoteId was sent | Upgrade to the two-step flow |
| `invalid_quote` (`expired`) | > 5 min old | Fetch a fresh quote, re-show the card |
| `quote_mismatch` | Terms differ from the quote | Fetch a fresh quote |
| `quote_stale` (409) | Pricing changed since the quote | Fetch a fresh quote, re-confirm |
| `insufficient_balance` | Balance below burn amount | Show shortfall (`details.available` / `required`) |

## Copy fixes requested alongside (screens observed 23 Jul)

1. **Success screen**: say "TZS 5,000 is on its way to JOHN DOE · fees TZS 1,533" — never
   present the gross burn as the amount "sent".
2. Replace the raw `burned` status with user-facing copy ("Processing payout" / "Sent").
3. The amount field's client-side balance error should disable the CTA (the API rejects
   over-balance anyway, but the button inviting a doomed tap is confusing).

## Timeline

- **Now:** both endpoints live; `quoteId` optional — integrate at your pace.
- **Enforcement date (to be agreed):** `quoteId` becomes mandatory; calls without it fail
  with `quote_required`.
