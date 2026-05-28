# Biashara & Enterprise — Migration to NEDApay

**Document owner**: NEDA Labs Limited  
**Last updated**: May 2026  
**Audience**: NEDApay Engineering Team  
**Classification**: Internal

---

## Status

| Phase | Owner | Status |
|-------|-------|--------|
| Phase 1 — nTZS schema additions | nTZS | ✅ Done — migration `0037` applied |
| Phase 2 — nTZS promoted API routes | nTZS | ✅ Done — live at `/api/v1/biashara/*` and `/api/v1/enterprise/*` |
| Phase 3 — NEDApay JWT + Prisma | NEDApay | ✅ Done — schema, token service, proxy routes written |
| Phase 4 — NEDApay frontend pages | NEDApay | 🔲 Pending |
| Phase 5 — Cleanup | Both | 🔲 Pending (after Phase 4 verified in prod) |

---

## Overview

Biashara (merchant portal) and Enterprise (lender portal) were built inside the nTZS repo as proof-of-concept features. They are now moving to NEDApay as first-class product features.

This document is the handoff guide for the NEDApay team. It covers what was built, the API contracts, and what remains.

---

## Background: How the Two Repos Relate

```
nTZS (infrastructure layer)
├── Stablecoin (nTZS token on Base)
├── WaaS — wallet provisioning for partners
├── SimpleFX — swap/liquidity
└── Backend API — business logic for all products

NEDApay (product layer — built on top of nTZS)
├── Consumer wallet & transfers
├── Biashara merchant dashboard     ← moving here
└── Enterprise lender dashboard     ← moving here
```

nTZS owns the database, business logic, and wallet infrastructure. NEDApay owns the user experience. NEDApay calls nTZS APIs — it does not connect to the nTZS database directly.

---

## User & Wallet Model

### One account, role-based features

Every NEDApay user has one account and one KYC-verified wallet. Biashara and Enterprise are features that unlock on top of that account — not separate products with separate logins.

```
NEDApay Account  (KYC verified → wallet provisioned via WaaS)
│
├── Consumer          ← default for all users
│
├── Merchant          ← unlocks Biashara dashboard
│   └── dedicated merchant wallet (separate from personal wallet)
│
└── Enterprise        ← unlocks Enterprise lender dashboard
    └── org treasury wallet (separate from personal wallet)
```

Feature access is carried in the NEDApay JWT as `productAccess`. The frontend reads this to show or hide navigation items. The backend validates it on every request.

### Wallet provisioning per feature

| Feature | How wallet is provisioned |
|---------|--------------------------|
| Consumer | `POST /api/v1/users` — called at NEDApay signup (already live) |
| Biashara | `POST /api/v1/users` with `externalId: "merchant_{nedapay_user_id}"` — called when merchant is activated |
| Enterprise | `POST /api/v1/partners/sub-wallets` with org name as label — called when org is approved in backstage |

See [09-WAAS-PARTNER-API.md](./09-WAAS-PARTNER-API.md) for full WaaS API reference.

---

## What Each Team Builds

| Work item | Owner | Status |
|-----------|-------|--------|
| Database schema additions | nTZS | ✅ Done |
| Promote backend routes to `/api/v1/*` | nTZS | ✅ Done |
| Service key auth on promoted routes | nTZS | ✅ Done |
| `productAccess` + `biasharaMerchantId` Prisma fields | NEDApay | ✅ Done |
| `EnterpriseOrgMembership` model | NEDApay | ✅ Done |
| JWT claims (`productAccess`, `biasharaMerchantId`, `enterpriseOrgs`) | NEDApay | ✅ Done |
| nTZS proxy helper (`src/lib/ntzs-proxy.ts`) | NEDApay | ✅ Done |
| Biashara proxy routes (`/api/v1/biashara/*`) | NEDApay | ✅ Done |
| Enterprise proxy routes (`/api/v1/enterprise/*`) | NEDApay | ✅ Done |
| Middleware route gating | NEDApay | 🔲 Pending |
| Biashara frontend pages | NEDApay | 🔲 Pending |
| Enterprise frontend pages | NEDApay | 🔲 Pending |
| Merchant activation flow | NEDApay | 🔲 Pending |
| Enterprise application flow | NEDApay | 🔲 Pending |
| Backstage enterprise approval extension | nTZS | 🔲 Pending |

---

## Phase 1 — nTZS: Schema additions ✅

Migration file: `drizzle/0037_biashara_enterprise_nedapay_link.sql`

Three non-breaking additions. All nullable — nothing existing breaks.

```sql
-- Track which NEDApay product features each user has unlocked
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS product_access text[] NOT NULL DEFAULT ARRAY['consumer']::text[];

-- Link merchant accounts to a NEDApay user
ALTER TABLE merchant_accounts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Link enterprise orgs to the NEDApay user who applied
ALTER TABLE enterprise_accounts
  ADD COLUMN IF NOT EXISTS linked_admin_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
```

---

## Phase 2 — nTZS: Promoted API routes ✅

All routes validate `x-service-key` (see [Service Key Auth](#service-key-auth) below) and accept the entity ID via header instead of a session cookie.

### Biashara routes (`x-merchant-id` header)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/biashara/collections` | Collections list (cursor-paginated) |
| `GET` | `/api/v1/biashara/links` | Payment links |
| `POST` | `/api/v1/biashara/links` | Create payment link |
| `DELETE` | `/api/v1/biashara/links?id=` | Delete payment link |
| `GET` | `/api/v1/biashara/stats` | Dashboard summary stats |
| `GET` | `/api/v1/biashara/profile` | Merchant account details |
| `PATCH` | `/api/v1/biashara/profile` | Update business name |

### Enterprise routes (`x-enterprise-id` header)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/enterprise/disbursements` | Disbursement batches list |
| `POST` | `/api/v1/enterprise/disbursements/upload` | Create batch with contractor rows |
| `GET` | `/api/v1/enterprise/disbursements/:id` | Batch detail + rows |
| `POST` | `/api/v1/enterprise/disbursements/:id/confirm` | Confirm batch (moves to `awaiting_funds`) |
| `GET` | `/api/v1/enterprise/wallet` | Org treasury wallet, balance, transfers |
| `GET` | `/api/v1/enterprise/lender/treasury-balance` | Treasury on-chain balance |

### Receipt route (public — no auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/receipt/:depositId` | Payment receipt for a completed collection |

### Service key auth

Every request from NEDApay to the routes above must include:

```
x-service-key: <NTZS_SERVICE_KEY>
x-merchant-id: <nTZS merchant UUID>   (Biashara routes)
x-enterprise-id: <nTZS org UUID>      (Enterprise routes)
```

The shared secret is stored as `NTZS_SERVICE_KEY` in both environments. Generate with `openssl rand -hex 32`.

---

## Phase 3 — NEDApay: JWT claims & proxy routes ✅

### Files changed / created

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `productAccess`, `biasharaMerchantId`, `EnterpriseOrgMembership` |
| `src/services/token.service.ts` | Extended `AccessTokenPayload` + `AuthUser`; wired new fields into `signAccessToken` and `refreshTokens` |
| `src/lib/ntzs-proxy.ts` | New — service-to-service proxy helper |
| `src/routes/biashara.routes.ts` | New — Biashara proxy route |
| `src/routes/enterprise.routes.ts` | New — Enterprise proxy route (with multi-org `?orgId=` support) |
| `src/routes/index.ts` | Registered both new routes |

### Prisma migration

Run after pulling the schema changes:

```bash
npx prisma migrate dev --name add-biashara-enterprise-access
```

### JWT shape

The NEDApay access token now carries:

```json
{
  "sub": "nedapay-user-uuid",
  "authId": "...",
  "email": "user@example.com",
  "wallet": "0xABC...",
  "type": "access",
  "productAccess": ["consumer", "merchant"],
  "biasharaMerchantId": "ntzs-merchant-uuid",
  "enterpriseOrgs": [
    { "orgId": "ntzs-enterprise-org-uuid", "role": "admin" }
  ]
}
```

`productAccess` defaults to `["consumer"]` for all users. `biasharaMerchantId` and `enterpriseOrgs` are populated when the respective features are activated.

### How the proxy works

`createNtzsProxy(basePath, idHeader, userField)` in `src/lib/ntzs-proxy.ts`:

1. Reads `req.user[userField]` (e.g. `biasharaMerchantId`) — returns 403 if absent
2. Forwards the request to `NTZS_API_URL + basePath + req.path`
3. Attaches `x-service-key` and `x-merchant-id` / `x-enterprise-id` headers
4. Streams the response status + body back to the client

No business logic lives in the proxy — it's a thin authenticated forwarder.

---

## Phase 4 — NEDApay: Frontend pages 🔲

### Middleware gating

Add to `middleware.ts` (or equivalent route guards):

```ts
if (pathname.startsWith('/merchant') && !token.productAccess.includes('merchant'))
  redirect('/dashboard?activate=merchant')

if (pathname.startsWith('/enterprise') && !token.productAccess.includes('enterprise'))
  redirect('/dashboard?activate=enterprise')
```

### Frontend pages

Copy the dashboard pages from nTZS into NEDApay as route groups. Update API call URLs only.

| Source (nTZS) | Destination (NEDApay) | API URL change |
|---------------|-----------------------|----------------|
| `/merchant/dashboard/page.tsx` | `/(biashara)/merchant/dashboard/page.tsx` | `/merchant/api/*` → `/api/v1/biashara/*` |
| `/merchant/dashboard/collections/page.tsx` | same pattern | same |
| `/merchant/dashboard/links/page.tsx` | same pattern | same |
| `/merchant/dashboard/settings/page.tsx` | same pattern | same |
| `/enterprise/dashboard/page.tsx` | `/(enterprise)/enterprise/dashboard/page.tsx` | `/enterprise/api/*` → `/api/v1/enterprise/*` |
| `/enterprise/dashboard/disbursements/*` | same pattern | same |
| `/enterprise/dashboard/wallet/page.tsx` | same pattern | same |

### Feature activation flows (new UI — NEDApay builds)

**Merchant activation:**
1. User completes KYB (business verification)
2. NEDApay calls `POST /api/v1/users` with `externalId: "merchant_{nedapay_user_id}"` to provision merchant wallet
3. nTZS creates `merchant_accounts` row, sets `user_id = nedapay_user_id`
4. NEDApay sets `productAccess = [..., 'merchant']` and `biasharaMerchantId = <ntzs id>` on the Prisma user
5. NEDApay issues a fresh JWT; Biashara tab becomes visible

**Enterprise application:**
1. User fills org details (name, type: `capital_lender` or `disbursement_client`)
2. NEDApay creates `enterprise_accounts` row in nTZS with `linked_admin_user_id = nedapay_user_id`, `isActive = false`
3. Application appears in nTZS backstage pending queue
4. nTZS backstage approves → provisions org treasury wallet → sets `isActive = true`
5. nTZS fires webhook to `NEDAPAY_WEBHOOK_URL/api/v1/webhooks/ntzs` (or NEDApay polls)
6. NEDApay sets `productAccess = [..., 'enterprise']`, creates `EnterpriseOrgMembership` row
7. Enterprise tab becomes visible

---

## Payment Receipts

The customer-facing payment flow and receipt page stay in nTZS:

```
Customer scans QR → ntzs.co.tz/m/{handle} → pays → ntzs.co.tz/receipt/{depositId}
```

NEDApay can optionally render receipts on its own domain using:

```
GET /api/v1/receipt/:depositId   (public — no auth required)
```

Response includes: `depositId`, `collectionId`, `amountTzs`, `payerName`, `payerPhone` (masked), `merchantBusinessName`, `merchantHandle`, `productName`, `linkDescription`, `pspReference`, `pspChannel`, `createdAt`.

The Biashara collections response includes `depositRequestId` per row — use this to construct the receipt URL.

---

## Phase 5 — Cleanup 🔲

> After Phase 4 is live and verified in production.

**nTZS removes:**
- `/merchant/dashboard/*` frontend pages
- `/enterprise/dashboard/*` frontend pages
- `/merchant/api/auth/*` routes (after all existing sessions expire — 30-day TTL)
- `/enterprise/api/auth/*` routes (same)
- Cookie auth from all promoted routes

**What stays in nTZS permanently:**
- `/m/[handle]` — customer-facing payment page
- `/receipt/[depositId]` — customer receipt page
- All `/api/v1/*` promoted routes
- Database schema, WaaS, SimpleFX

---

## Environment Variables

### NEDApay `.env`

```env
NTZS_API_URL=https://www.ntzs.co.tz
NTZS_SERVICE_KEY=<shared secret — generate with: openssl rand -hex 32>
```

### nTZS `.env`

```env
NTZS_SERVICE_KEY=<same shared secret>
NEDAPAY_WEBHOOK_URL=https://api.nedapay.com   # for enterprise approval notifications
```

---

## Contact

For questions on the nTZS side — database schema, API contracts, WaaS provisioning, backstage access — reach out to the nTZS team.
