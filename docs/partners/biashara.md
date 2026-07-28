# Biashara — embed a full merchant product in your app

**Audience:** partner engineering teams embedding merchant payments (e.g. a bank's merchant tab)
**Status:** live · requires the `biashara` capability + approved KYB · no sandbox (the rails are
proven against real payments — see *Testing* below)

## What this unlocks

A complete merchant product inside **your** app, under **your** UI: your customer becomes a
merchant, collects payments by QR or payment link, watches sales, controls how much auto-settles
to mobile money, cashes out — and, where a lender is attached, draws **working capital** against
their sales history.

Your customers never see nTZS. They see *balance*, *sales today*, *cash out*, *advance*. nTZS is
the settlement rail underneath; you integrate over plain REST.

You hold no wallet, no key, and no float. There is nothing to custody on your side.

## Authentication

```
Authorization: Bearer <your partner api key>
x-merchant-id: <merchant id from activation>
```

Standard partner key — the same one you already use for `/api/v1/users`. The `biashara`
capability must be enabled on your account (it requires approved KYB, because it moves merchant
money).

**Tenant isolation.** A key can only ever see merchants it created. A merchant id belonging to
another partner returns `404`, not `403` — we never confirm that another tenant's id exists.

## The flow

### 1. Activate a customer as a merchant

Provision the user first via `POST /api/v1/users` (WaaS), then:

```
POST /api/v1/biashara/accounts
{ "userId": "<nTZS user id>", "email": "shop@example.co.tz",
  "businessName": "Duka la Asha", "settlementPhone": "0744277496" }
```

```json
{ "merchantId": "…", "handle": "dukalaasha", "walletAddress": "0x…", "businessName": "Duka la Asha" }
```

Idempotent per `userId`/`email` **within your own book** — calling it again returns the same
merchant with `"alreadyExists": true`.

`handle` is the merchant's public payment identity and is globally unique across the platform. If
your preferred handle is taken we assign the next free variant and return it — activation never
fails on a collision, so **always read the handle back** rather than assuming.

### 2. Collect payments

```
GET    /api/v1/biashara/links      → existing payment links / QR codes
POST   /api/v1/biashara/links      → create one
DELETE /api/v1/biashara/links      → remove one
```

A link resolves to a public payment page at `/pay/<handle>`, which is also what a QR encodes.
Payers pay from any mobile money account; funds land in the merchant's balance automatically.

### 3. Show the merchant their business

```
GET /api/v1/biashara/stats        → sales today / this month
GET /api/v1/biashara/collections  → payment history (cursor-paginated, ?limit= up to 50)
GET /api/v1/biashara/wallet       → current balance
```

### 4. Settlement and cash-out

```
GET   /api/v1/biashara/settlement  → auto-settle percentage + payout phone
PATCH /api/v1/biashara/settlement  → change them
POST  /api/v1/biashara/withdraw    → cash out to mobile money
                                     { "amountTzs": 10000, "phone": "0744277496" }
```

`amountTzs` on withdraw is the **net the merchant receives** (minimum 5,000 TZS); fees are added
on top and disclosed in the response.

Settlement changes are blocked while a lender controls settlement — see below.

### 5. Working capital

```
GET  /api/v1/biashara/financing/status              → facility, drawn, available, repayment
POST /api/v1/biashara/financing/withdraw            → draw against the facility
POST /api/v1/biashara/financing/invites/{id}/respond → accept/decline a lender offer
```

This is the part a QR generator cannot do. A lender attached to the merchant can offer a facility
against observed sales; repayment happens automatically out of a share of each sale. When a lender
controls settlement, the merchant's own settlement controls are read-only — surface that in your UI
rather than letting the call fail.

### 6. Business assistant (optional)

```
POST /api/v1/biashara/ai/chat
```

Answers the merchant's questions about their own sales data in Swahili or English.

## Errors

| Code | Meaning |
| --- | --- |
| `401` | Bad or missing key |
| `403` | `biashara` capability not enabled on your account |
| `404` | Merchant not found **or not yours** |
| `400` | Missing `x-merchant-id`, or a validation failure |
| `501` | A test-mode key was used — Biashara has no simulator |

## Testing

Biashara is **not** simulated in test mode: a `ntzs_test_` key gets `501`. The merchant rails run
against live payment providers and are proven by real transactions, so the meaningful test is a
real one — activate a merchant, create a link, push a small payment (1,000 TZS) to a phone you
control, and watch it appear in `/collections`, `/stats` and `/wallet`, then `/withdraw` it back
out. That exercises the entire loop end to end, including settlement.

The rest of the platform (`/api/v1/users`, deposits, withdrawals, spend) *does* have a full
sandbox — see the Test Mode section of the partner API reference.

## Limits

nTZS operates under the Bank of Tanzania regulatory sandbox, which caps pilot participants and
per-transaction amounts. Merchant cohorts are agreed before launch — talk to us about numbers
before you plan a rollout.

**A collection mints nTZS to the merchant, so the merchant is the capped participant** — not the
payer, who pays out of their own mobile money and never holds the token. Three limits apply to
every collection, counted against the merchant's total nTZS activity (collections *and*
withdrawals) in the period:

| Limit | Amount | Error code |
|---|---|---|
| Per transaction | 1,000,000 TZS | `per_txn_cap` |
| Per day | 2,000,000 TZS | `daily_user_cap` |
| Per 30 days | 60,000,000 TZS | `monthly_user_cap` |

A blocked collection returns `400` with the code above plus
`details.limit` / `details.requested` / `details.usedInPeriod`, so your UI can tell the merchant
exactly how much headroom is left rather than showing a generic failure. Design for it: a busy
till reaches the daily limit, and the right experience is "you can collect X more today", not an
error toast.
