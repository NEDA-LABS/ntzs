# nTZS × Selcom — Integration Specification

**Version:** 1.0  
**Date:** June 2026  
**Reference:** nTZS–Selcom MOU (submitted to Bank of Tanzania, Sandbox Phase)  
**Prepared by:** nTZS Engineering Team  
**For:** Selcom Integration & API Team

---

## 1. Introduction

nTZS is a regulated digital Tanzanian Shilling stablecoin operating under the Bank of Tanzania's Payment Systems Sandbox. Each nTZS token is backed 1:1 by fiat TZS held in custody.

Selcom has been appointed as nTZS's **custodian bank and primary payment service provider** under the terms of the signed MOU. This document defines the technical integration required to operationalize that agreement.

Selcom will serve **two distinct but related roles**:

| Role | Description |
|------|-------------|
| **Payment Service Provider (PSP)** | Process mobile money and bank collections from nTZS users; disburse TZS to users and merchants on redemption |
| **Custodian Bank** | Hold nTZS fiat reserves; maintain 50% of reserves in T-bills per BoT sandbox conditions; provide balance reporting for regulatory oversight |

> **Important:** Selcom will operate **in parallel** with our existing PSP partners. Snippe continues serving legacy users without interruption. AzamPay remains available as a fallback. Selcom becomes the **default PSP for new users** from go-live.

---

## 2. Integration Overview

### 2.1 Collection Flow (On-Ramp)

```
User initiates deposit
        │
        ▼
nTZS initiates payment request → Selcom PSP API
        │
        ▼
Selcom sends mobile money push prompt to user's phone
        │
        ▼
User approves on phone
        │
        ▼
Selcom → nTZS webhook (payment.completed / payment.failed)
        │
        ├── Amount < 1,000,000 TZS → Mint nTZS immediately
        └── Amount ≥ 1,000,000 TZS → Requires custodian bank approval before mint
```

### 2.2 Disbursement Flow (Off-Ramp)

```
User redeems nTZS
        │
        ▼
nTZS burns nTZS tokens on-chain
        │
        ▼
nTZS initiates payout request → Selcom PSP API
        │
        ▼
Selcom sends TZS to user's phone / bank account
        │
        ▼
Selcom → nTZS webhook (payout.completed / payout.failed)
        │
        └── If failed: nTZS automatically re-mints tokens to user wallet
```

### 2.3 Custodian Reserve Flow

```
Selcom custodian account holds fiat TZS float
        │
        ├── 50% → T-bills (per BoT sandbox condition)
        └── 50% → Liquid float for disbursements
                │
                ▼
        nTZS queries Selcom for balances
                │
                ▼
        BoT Oversight Dashboard shows real-time reserve proof
```

---

## 3. What We Need from Selcom

The items below are **prerequisites** before nTZS can begin technical implementation. We request that Selcom provide responses to all items.

### 3.1 API Access

| # | Item Required | Format/Notes |
|---|---------------|--------------|
| 1 | **Sandbox API credentials** | API key, client ID, or client secret (whichever auth method applies) |
| 2 | **Sandbox base URL** | e.g. `https://sandbox.selcom.net/api` |
| 3 | **Production base URL** | e.g. `https://api.selcom.net/v1` |
| 4 | **Authentication method** | One of: API key in header, HMAC-signed request, OAuth2 client credentials |
| 5 | **API documentation** | OpenAPI spec or Postman collection preferred |

### 3.2 Collection (Mobile Money)

| # | Item Required | Notes |
|---|---------------|-------|
| 6 | **Initiate payment endpoint** | Endpoint to push a mobile money payment request to a phone number |
| 7 | **Required request parameters** | Amount, phone, reference, callback URL, metadata fields |
| 8 | **Phone number format accepted** | `255XXXXXXXXX`, `0XXXXXXXXX`, or `+255XXXXXXXXX`? |
| 9 | **Supported MNOs** | Which mobile networks are supported (Vodacom M-Pesa, Airtel Money, Tigo Pesa, Halotel Halo-Pesa, TTCL)? |
| 10 | **Payment status endpoint** | Endpoint to poll payment status by our reference ID |
| 11 | **Payment status values** | What are the possible status strings? (e.g. `COMPLETED`, `PENDING`, `FAILED`, `EXPIRED`) |

### 3.3 Disbursement (Payouts)

| # | Item Required | Notes |
|---|---------------|-------|
| 12 | **Mobile money payout endpoint** | Endpoint to disburse TZS to a mobile phone number |
| 13 | **Bank transfer payout endpoint** | Endpoint to disburse TZS to a bank account number |
| 14 | **Payout request parameters** | Amount, recipient phone/account, name, narration, reference, callback URL |
| 15 | **Payout status endpoint** | Endpoint to poll payout status by reference |
| 16 | **Payout status values** | What are the possible status strings? |
| 17 | **Float/balance endpoint** | Endpoint to check our available disbursement float balance |

### 3.4 Webhook Callbacks

This is one of the most critical items. Our system relies on webhooks for real-time payment confirmation — a missed or malformed webhook delays a user's nTZS minting.

| # | Item Required | Notes |
|---|---------------|-------|
| 18 | **Webhook event names** | e.g. `payment.completed`, `payment.failed`, `payout.completed`, `payout.failed` — what exactly does Selcom send? |
| 19 | **Full webhook payload schema** | JSON field names and types for each event type |
| 20 | **Signature method** | How does Selcom sign webhook deliveries? (HMAC-SHA256 preferred) |
| 21 | **Signature header name** | e.g. `x-selcom-signature`, `x-webhook-hmac` |
| 22 | **Signing format** | Is it `HMAC(secret, rawBody)`? Or `HMAC(secret, timestamp + "." + rawBody)`? |
| 23 | **Selcom source IP range** | IPs from which webhooks will be delivered (for firewall allowlisting) |
| 24 | **Sandbox webhook behavior** | Does Selcom fire real webhooks in sandbox, or must we use a simulator/test tool? |
| 25 | **Retry policy** | How many times will Selcom retry failed webhook deliveries, and on what schedule? |

### 3.5 Error Handling

| # | Item Required | Notes |
|---|---------------|-------|
| 26 | **Full error code list** | All possible API error codes with descriptions |
| 27 | **Transient vs. terminal classification** | Which errors are safe to retry automatically? (e.g. network timeout vs. invalid account) |
| 28 | **Idempotency support** | Can we safely retry a payment/payout request with the same reference if we don't get a response? |

### 3.6 Custodian Banking — T-Bill Reserves

These items are unique to Selcom's role as custodian bank and are required for BoT compliance reporting.

| # | Item Required | Notes |
|---|---------------|-------|
| 29 | **Custodian account number** | The TZS account that will hold nTZS float |
| 30 | **T-bill account/portfolio reference** | Reference number for the 50% T-bill allocation |
| 31 | **T-bill balance API** | Can Selcom expose an API endpoint for us to query the current T-bill balance in real-time? |
| 32 | **Statement cadence** | If no API, how frequently will Selcom provide T-bill balance statements? (Daily preferred) |
| 33 | **Large deposit approval webhook** | For deposits ≥ 1,000,000 TZS, will Selcom send a webhook confirming fiat has cleared in the custodian account before we mint nTZS? This is a BoT sandbox requirement. |
| 34 | **Reserve reporting format** | Does Selcom have a standard format for reserve attestation / proof-of-funds? |

### 3.7 Go-Live Requirements

| # | Item Required | Notes |
|---|---------------|-------|
| 35 | **Sandbox onboarding steps** | What do we need to complete before sandbox access is provisioned? |
| 36 | **Production go-live checklist** | What does Selcom require before flipping to production? |
| 37 | **Rate limits** | Requests per second / per minute for collection and disbursement APIs |
| 38 | **SLA** | Selcom's target uptime and response time SLA for the APIs |
| 39 | **Support contact** | Technical point of contact for integration issues |

---

## 4. What nTZS Will Build

This section describes what our engineering team will implement on our side once items in Section 3 are received.

### 4.1 Selcom PSP Adapter
**File:** `apps/web/src/lib/psp/selcom.ts`

A self-contained adapter implementing the same interface as our existing Snippe and AzamPay adapters:

```typescript
// Collection
initiatePayment(req)          → initiate mobile money push to user
checkPaymentStatus(reference) → poll payment by reference

// Disbursement  
sendPayout(req)               → disburse TZS to mobile number
sendBankPayout(req)           → disburse TZS to bank account
checkPayoutStatus(reference)  → poll payout by reference

// Float
getBalance()                  → check available TZS float
```

The adapter will handle:
- Authentication (API key, HMAC, or OAuth — determined by Selcom's method)
- Phone number normalization to Selcom's expected format
- Automatic retry on transient errors (up to 3 attempts)
- Structured error mapping to internal error types

### 4.2 Webhook Handlers

Two new endpoints in our Next.js API:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/webhooks/selcom/payment` | Receive collection confirmations from Selcom |
| `POST /api/webhooks/selcom/payout` | Receive disbursement confirmations from Selcom |

Each handler will:
- Verify Selcom's webhook signature (HMAC-SHA256 or as specified)
- Validate the payment amount matches what was requested (security check)
- Update deposit/payout status in the database
- Trigger on-chain nTZS minting for confirmed collections
- Trigger automatic revert (re-mint) if a payout fails

### 4.3 Webhook URLs We Will Register with Selcom

| Event | URL |
|-------|-----|
| Payment completed/failed | `https://app.ntzs.io/api/webhooks/selcom/payment` |
| Payout completed/failed | `https://app.ntzs.io/api/webhooks/selcom/payout` |

Both endpoints require TLS (HTTPS only). We do not accept HTTP webhook deliveries.

### 4.4 Parallel PSP Routing

nTZS supports multiple PSPs simultaneously. Each transaction records which PSP processed it. Selcom will be set as the **default PSP for new users**. Existing Snippe and AzamPay transactions continue uninterrupted.

| PSP | Status after Selcom go-live |
|-----|-----------------------------|
| Snippe | Active — serves existing users |
| AzamPay | Active — commercial fallback |
| Selcom | Active — default for new users |

### 4.5 Polling Fallback
**File:** `apps/web/src/app/api/cron/poll-selcom/route.ts`

A background cron job that polls Selcom's status API for any deposits where our webhook was not received (network failure, webhook downtime, etc.). This is a safety net — primary flow is webhook-driven.

### 4.6 Reserves Dashboard Update
**File:** `apps/web/src/app/api/oversight/reserves-report/route.ts`

Our BoT oversight dashboard will be updated to show Selcom's custodian balance split:
- Total fiat TZS held by Selcom (liquid float)
- T-bill balance (50% allocation)
- Combined total vs. nTZS on-chain supply (proof of 1:1 backing)

### 4.7 Database Schema Update
**File:** `packages/db/src/schema.ts`

- Add `'selcom'` to the `pspProvider` enum
- Add Selcom as a named entry in the `banks` table (used in the deposit approval workflow for large-value mints)

### 4.8 Environment Variables Required

```
SELCOM_API_KEY=<from Selcom>
SELCOM_API_SECRET=<from Selcom, if HMAC/OAuth>
SELCOM_WEBHOOK_SECRET=<from Selcom, for signature verification>
SELCOM_ENV=sandbox            # sandbox | production
SELCOM_BASE_URL=<Selcom API base URL>
```

---

## 5. Security Requirements

### 5.1 Webhook Security

- All webhook deliveries to nTZS **must** include an HMAC-SHA256 signature in a request header
- nTZS will reject any webhook delivery that fails signature verification
- We request that Selcom also enforce a **5-minute timestamp window** to prevent replay attacks
- Webhook source IP should be restricted to Selcom's declared IP range

### 5.2 Transport Security

- All API communication over TLS 1.2+ (HTTPS only)
- No HTTP fallback accepted on either side
- Certificate pinning is optional but recommended for production

### 5.3 Credential Management

- Selcom API credentials will be stored as environment secrets (not in source code)
- Separate credentials for sandbox and production environments
- nTZS will rotate credentials on demand if a breach is suspected

### 5.4 Amount Validation

nTZS implements **double-verification** of payment amounts: the amount reported in the webhook must match the amount originally requested. Any mismatch causes the deposit to be rejected (not minted). This protects against underpayment attacks.

---

## 6. Proposed Milestones

| Milestone | Owner | Target |
|-----------|-------|--------|
| Selcom provides sandbox credentials + API docs (items 1–5) | Selcom | Week 1 |
| Selcom confirms webhook spec (items 18–25) | Selcom | Week 1 |
| Selcom confirms custodian/T-bill reporting approach (items 29–34) | Selcom | Week 2 |
| nTZS builds `selcom.ts` adapter and webhook handlers | nTZS | Week 2–3 |
| Sandbox end-to-end test: collection flow | nTZS + Selcom | Week 3 |
| Sandbox end-to-end test: disbursement flow | nTZS + Selcom | Week 3 |
| Sandbox reserves reporting validation | nTZS + Selcom + BoT | Week 4 |
| Production go-live checklist signed off | Selcom | Week 5 |
| Production launch (Selcom as default PSP for new users) | nTZS | Week 6 |

> Note: BoT Sandbox approval requires testing to begin by ~23 June 2026. We are targeting Week 1 as the earliest Selcom can provide sandbox access.

---

## 7. Contact

**nTZS Technical Lead**  
Email: v.muhagachi@gmail.com

**Selcom Integration Contact**  
_(Please provide name, email, and Slack/WhatsApp for day-to-day coordination)_

---

*This document is confidential and intended solely for the Selcom integration team and nTZS engineering. It references the MOU submitted to the Bank of Tanzania under the Sandbox Programme.*
