# nTZS — Security Assessment & Liability Review

**Prepared for:** NEDA Labs Limited — Office of the CTO
**Prepared by:** Security Engineering (CTO's office)
**Date:** 2 July 2026
**Classification:** Confidential — Regulatory (Bank of Tanzania Sandbox)
**Scope commit:** `main` @ `d59fefc` · branch `claude/ntzs-security-assessment-falqmq`

---

## 1. Executive summary

nTZS is a fiat-backed stablecoin issuing real value on Base mainnet and preparing to onboard users under the Bank of Tanzania (BoT) regulatory sandbox (testing to commence by 23 June 2026). This review assessed the whole platform: the Next.js application (187 API routes), the background worker and market-maker, the UUPS-upgradeable ERC-20 contract, the PSP/webhook money-in boundary, the WaaS partner surface, secrets/key management, dependencies, and build/operations posture.

**Overall posture.** The application is, in most places, **written by an engineering team that understands security**: HMAC webhook verification is constant-time and fails closed, the primary mint path is atomically claimed and cap-reserved, AES-256-GCM seed encryption is implemented correctly, OTP is hardened, WaaS object-level authorization (IDOR) is consistently enforced, and no secrets are committed to git history. These are real strengths and are documented in §6.

**However**, for a system that mints money and is entering a central-bank sandbox, we identified **defects that can break the 1:1 reserve peg and a set of governance/control gaps that create direct regulatory liability.** The most serious are:

- **Two distinct paths that can mint unbacked nTZS** — a mint-retry race after an on-chain confirmation is lost, and a non-idempotent treasury "remint" that a partner can trigger and replay. Either breaks the core invariant the sandbox exists to protect.
- **A systemic authentication bypass on all 14 cron endpoints**, which gate minting, fund sweeps, settlement, and the BoT reserve-attestation email.
- **A hard-coded wallet-authentication signing key committed to the repository**, which — if the production override is unset — lets anyone forge a user's Coinbase-embedded-wallet session.
- **A material contradiction between what the regulator was told and what the code enforces**: "dual approval before every mint," "high-value mints require the multisig," and per-mint on-chain caps are documented but **not enforced in code**; the ops tooling signs admin actions with a single private key while the documents describe a Gnosis Safe multisig.
- **A live dependency base with 89 known vulnerabilities (2 critical) and no CI/CD security gate at all.**

None of these are reasons to doubt the concept or the team — they are a prioritized, fixable list. §7 gives a remediation roadmap mapped to the sandbox timeline. §8 lists the facts that must be **verified against production and disclosed truthfully to BoT** before onboarding.

### Severity summary

| Severity | Count | Findings |
|---|---:|---|
| **Critical** | 4 | C1 Mint-retry double-mint · C2 Treasury-remint unbacked mint · C3 Cron auth bypass · C4 Hardcoded CDP signing key* |
| **High** | 11 | H1 Single-EOA admin vs claimed multisig · H2 Full on-chain centralization, no timelock · H3 MINTER+BURNER on one hot key · H4 No separation of duties · H5 Caps bypassed on LP/consumer/enterprise paths · H6 Worker cap ignores issued total · H7 Off-ramp revert re-mint · H8 "Viewer" role can withdraw LP funds · H9 No session/role revocation · H10 Stored XSS (merchant image proxy) · H11 Vulnerable dependencies + no CI/CD (2 critical CVEs) |
| **Medium** | 12 | M1 No login rate-limiting · M2 Debug endpoints leak data · M3 Unauth receipt PII · M4 Unauth oversight over-exposure · M5 Unauth AI-chat cost abuse · M6 S2S tenant via client header · M7 TOCTOU per-user caps · M8 Manual mint skips cap · M9 Poll crons skip amount check · M10 AzamPay webhook unverified scheme · M11 CSV/formula injection in exports · M12 SSRF via partner webhook URL |
| **Low / Info** | 15+ | see §5.4 |

\* C4 is Critical **if** `CDP_JWT_PRIVATE_KEY_JWK` is unset in production (likely — it is absent from `.env.example` and all docs); High otherwise. Verify immediately (§8).

> Note on dependencies: H11 is rated High as a *program* gap, but it includes **two critical-severity CVEs** (`jspdf`, `better-auth`) requiring emergency patching, plus a SQL-injection advisory in the ORM that backs the entire ledger.

---

## 2. Scope & methodology

**In scope:** `apps/web` (Next.js app + all API routes), `apps/worker`, `apps/market-maker`, `packages/contracts` (NTZS/NTZSV2/NTZSV3), `packages/db`, `packages/sdk`, `packages/shared`, database migrations, docs, scripts, dependency tree, and build/CI configuration.

**Method:** Manual code review of every trust boundary, supported by eight parallel focused review streams (authentication/RBAC, webhooks/PSP, mint/burn integrity, smart contract, secrets/keys, API authorization/cron/debug, input-validation/web, dependencies/supply-chain). Findings were traced to source and are tagged **Confirmed** (code path verified) or **Suspected** (depends on production runtime/on-chain state we could not read from this environment). Dynamic testing against production was **not** performed; on-chain reads to Base and live environment variables were not available and are called out as verification items (§8).

**What this review is not:** It is not a substitute for the independent third-party smart-contract audit and application penetration test that the sandbox requires (§7, §8). It is an internal readiness assessment to drive remediation before those engagements.

---

## 3. System overview (as built)

- **Token:** `NTZSV2`, UUPS-upgradeable ERC-20 on Base mainnet (proxy `0xF476BA983DE2F1AD532380630e2CF1D1b8b10688`), roles for mint/burn/pause/freeze/blacklist/wipe. OpenZeppelin v5 base. Admin address `0xB2b8…C503` documented as a Gnosis Safe (see H1).
- **Issuance:** fiat paid via Snippe/AzamPay → signed webhook → `deposit_requests` state machine → `executeMint()` signs `mint()` with a hot `MINTER_PRIVATE_KEY`. Off-chain `daily_issuance` cap.
- **Data:** Neon PostgreSQL (system of record) + AWS S3 / Vercel Blob (KYC/KYB) + on-chain supply (canonical). Drizzle ORM.
- **Auth:** five independent stacks — Neon Auth (main app RBAC), bespoke OTP+JWT for merchant / enterprise / SimpleFX-LP, an HMAC partner-session/API-key scheme, an ES256 CDP federation, and a shared service key for NEDApay↔nTZS.
- **Ops:** Vercel serverless (web) + Fly.io (worker, market-maker) + 14 cron routes. **No `middleware.ts`** — every route hand-rolls its own authorization.

---

## 4. Cross-cutting themes (root causes)

1. **No central authorization layer.** With no `middleware.ts`, all 187 routes enforce auth individually. This is the structural cause of C3 (cron bypass), M2 (debug endpoints), M3 (receipt PII), and the inconsistent constant-time/fail-open behavior across secrets. A single matcher over `/api/cron`, `/api/internal`, `/api/debug`, `/api/backstage`, `/api/admin` would eliminate a class of bugs.
2. **On-chain idempotency is missing from `mint()`.** The ERC-20 `mint(to, amount)` has no per-deposit key, so every safety property against double-issuance lives in fragile off-chain DB state. C1 and C2 both exploit that. One on-chain idempotency key closes both at the token level.
3. **Documentation describes controls the code does not enforce.** Dual-approval, "high-value mint needs the Safe," per-mint caps, and multisig admin are described to the regulator but are not in the code path (H1, H2, H4). This is the central *liability* theme, distinct from the technical bugs.
4. **Off-chain caps are enforced on some money paths but not others** (H5, H6, M7, M8). The BoT sandbox limits are only as strong as the least-guarded issuance path.
5. **No automated security gate.** No CI means vulnerable dependencies (H11), secret leaks, and failing contract tests can reach production undetected.

---

## 5. Detailed findings

Severity key: **Critical** = realistically-exploitable unbacked issuance / fund loss / full auth bypass. **High** = fund loss under narrower conditions, privilege escalation, or mandatory-disclosure centralization. **Medium** = meaningful weakness needing compensating controls. **Low/Info** = hardening.

### 5.1 Critical

#### C1 — Double-mint: a confirmed on-chain mint whose local confirmation is lost is retried, minting unbacked nTZS
**Confirmed.** `apps/web/src/lib/minting/executeMint.ts:141` (`await tx.wait(1)`) → catch `:187-206`; retry via `apps/web/src/app/backstage/minting/page.tsx:424-450` (`retryMintAction`).

`executeMint` broadcasts `mint()`, then `await tx.wait(1)`. If `tx.wait` throws for a *transient* reason (Base RPC timeout, Vercel `maxDuration`), the transaction may still be mined, but the catch marks the deposit `mint_failed` and **releases the daily-cap reservation**. The Backstage "Retry Mint" action then resets the deposit to `mint_pending` **with no status predicate and no check of the existing `mint_transactions.txHash`**, so `executeMint` mints a **second** time. `mint_transactions` (unique on `deposit_request_id`) is overwritten via `onConflictDoUpdate`, so nothing catches the duplicate. `retryMintAction` is callable by `super_admin` **or** `bank_admin` and has no current-status guard, so a single admin (or a forged form POST) can also reset a `minted`/`mint_processing` deposit straight back to `mint_pending`.

*Impact:* 900,000 TZS paid → 1,800,000 nTZS in circulation against 900,000 TZS reserve. Breaks the 1:1 peg with no alarm (the cap reservation was released and re-taken, so it looks like a fresh mint).

*Remediation:* Treat `tx.wait` failure as **unknown**, not failed — introduce a `mint_unconfirmed` state reconciled against the chain, never blindly retried. Before any re-mint, look up the prior `txHash` and query the chain; if confirmed, transition to `minted`. Add a status predicate (`… WHERE status='mint_failed'`) to `retryMintAction`. Strategic fix: give `mint()` an on-chain per-deposit idempotency key (see §4.2).

#### C2 — Unbacked mint via non-idempotent, metadata-trusting treasury "remint" (partner-reachable replay)
**Confirmed** (missing idempotency + arbitrary webhook target). `apps/web/src/app/api/webhooks/snippe/payout/route.ts:86-150` (remint `:113`), `azampay/payout/route.ts:72-136`; enablers `api/v1/partners/treasury/withdraw/route.ts:184-192` and `api/v1/partners/webhook/route.ts:32-54`.

On a `payout.failed` webhook where `metadata.type === 'treasury_withdrawal'`, the handler calls `remintTreasury(Number(metadata.amountTzs), metadata.treasuryWallet)` — a raw `mint()`. This branch has **no idempotency / no atomic claim** (unlike the user-burn branch in the same file at `:195-251`, which claims `payoutStatus='reverting'`), **trusts the webhook payload for amount and destination**, and **bypasses the daily/per-tx caps**. Webhook delivery is at-least-once, and `remintTreasury` awaits `tx.wait(1)` (seconds), which can exceed the PSP timeout and provoke retries.

*Exploit (self-service partner):* Partner sets their own `webhookUrl` (`PUT /api/v1/partners/webhook`, protocol-only validation) → calls `POST /api/v1/partners/treasury/withdraw` → arranges the payout to fail → PSP delivers a **validly-signed** `payout.failed` to the partner's endpoint → partner replays that signed body to `POST /api/webhooks/snippe/payout` repeatedly (fresh within the 5-minute window; unbounded if `*_WEBHOOK_ALLOW_UNTIMED=1`). Each replay mints `amountTzs` unbacked nTZS to the partner treasury, which they then off-ramp for real fiat.

*Remediation:* Persist treasury withdrawals as first-class rows keyed by PSP payout reference; gate the remint on an atomic status claim (mirror the `reverting` pattern). Never trust `metadata` for value/destination — look up the withdrawal and use the partner's **registered** `treasuryWalletAddress`. Route the remint through the capped mint path. Use a **fixed internal** webhook URL for platform-account payouts, never the partner's URL.

#### C3 — Cron authentication is bypassable on every one of the 14 cron endpoints
**Confirmed in code; spoofability is environment-dependent.** All `apps/web/src/app/api/cron/*`. Identical guard, e.g. `process-mints/route.ts:22-25`, `fx-fee-sweep/route.ts:55-58`, `settle/route.ts:22-25`, `daily-attestation/route.ts:16-19`:

```js
const CRON_SECRET = process.env.CRON_SECRET || ''
const isVercelCron = request.headers.get('x-vercel-cron') === '1'
if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) { return 401 }
```

Two compounding defects: (a) `x-vercel-cron` is a **client-settable header**, so `-H "x-vercel-cron: 1"` bypasses the check even when `CRON_SECRET` is set; (b) the `CRON_SECRET &&` guard **fails open** if the variable is unset in any environment. These endpoints trigger minting (`process-mints`), ERC-20 sweeps from a solver key (`fx-fee-sweep`), settlement and nTZS→USDC delivery (`settle`, `ramp-settle`), yield credit (`accrue-yield`), and the **BoT reserve-attestation email** (`daily-attestation`).

*Impact (honest):* Most jobs are advisory-locked and idempotent and act on already-queued legitimate work, so triggering them is **not by itself** a direct fund-theft primitive. Demonstrable harm: forced off-schedule execution, RPC/PSP quota exhaustion, on-demand spamming of regulator/ops attestation and alert emails, and amplification of any downstream state bug (including C1). Rated Critical as a systemic authentication failure on a mainnet money-moving surface.

*Remediation:* Delete the `x-vercel-cron` branch; **fail closed** (503) when `CRON_SECRET` is missing; compare with `crypto.timingSafeEqual`; enforce via one shared helper or `middleware.ts` matching `/api/cron/:path*`.

#### C4 — Hard-coded CDP wallet-federation signing key committed to the repo (with silent fail-open)
**Confirmed in code; Critical if the production override is unset (verify §8).** `apps/web/src/lib/cdp-jwt.ts:11-20` (committed `DEV_PRIVATE_KEY`, including the EC `d` scalar), fallback `:38-48`, used by `signCDPToken` and `api/auth/cdp-token/route.ts`; public half published at `.well-known/jwks.json` and `api/auth/cdp-jwks`.

`getPrivateKey()` falls back to a **private ES256 key hard-coded in source** whenever `CDP_JWT_PRIVATE_KEY_JWK` is unset (only a `console.warn`). That key signs the JWT that authenticates a user to Coinbase CDP embedded wallets (`{sub: userId, …}`); the JWKS endpoint publishes the **matching public key** (also from the committed dev key when the env var is unset), so a forged token verifies. `CDP_JWT_PRIVATE_KEY_JWK` appears **nowhere** in `.env.example` or docs, so operators are never told to set it — production most likely runs on the committed key.

*Exploit:* Anyone with the repo signs a token with `sub` = a victim's user id (user ids leak through partner endpoints and receipt links), presents it to CDP as that user, and moves the victim's nTZS/USDC. Blast radius: every end user with a CDP embedded wallet.

*Remediation:* Delete `DEV_PRIVATE_KEY`/`DEV_PUBLIC_KEY`; make `getPrivateKey()` **throw** when the env var is missing; **rotate the keypair immediately** (treat the committed one as compromised) and purge from history; document the variable; tighten JWKS/token CORS.

### 5.2 High

#### H1 — Admin/upgrade authority appears to be a single EOA, not the Gnosis Safe the docs claim
**Confirmed in-repo contradiction; on-chain reality must be verified (§8).** `packages/contracts/scripts/grant-minter-to-safe.ts:8-9,28,38,54`, `grant-minter-role.ts:22-56` vs `docs/04,05,06`.

The docs state the multisig Safe `0xB2b8…C503` holds `DEFAULT_ADMIN_ROLE` "exclusively." The ops scripts contradict this: they load `SAFE_ADMIN_PRIVATE_KEY` and sign `grantRole()` directly with `new ethers.Wallet(...)`. **A Gnosis Safe is a contract and has no private key.** So either the true admin is a **single EOA** (mint/burn/pause/freeze/wipe/**upgrade** controlled by one key, no quorum — directly contradicting the BoT submission), or the scripts are non-functional. **If a single EOA holds admin, this is Critical.**

*Remediation:* Read `eth_getCode(0xB2b8…C503)` and `hasRole(DEFAULT_ADMIN_ROLE, …)` on the proxy. If an EOA holds admin, transfer all admin/Safe-only roles to a real ≥2-of-N multisig, revoke the EOA, delete `SAFE_ADMIN_PRIVATE_KEY` from tooling, and correct the docs. If a Safe already holds it, delete the misleading scripts.

#### H2 — Full on-chain centralization: unbounded mint, arbitrary-balance burn/wipe, instant upgrade — no timelock
**Confirmed (mandatory regulator disclosure).** `NTZSV2.sol:68-70` (mint, no cap), `:72-74` (burn any `from`), `:108-117` (wipe, even while paused), `:119` (`_authorizeUpgrade`).

The admin can grant itself every role, mint unlimited unbacked supply, destroy or seize any holder's balance, and upgrade to arbitrary logic — all with immediate effect and **no timelock**. The documented safeguards ("high-value mint requires the Safe," a per-mint cap, "two-person approval") are **not enforced on-chain**; the only issuance limit is an off-chain DB counter a super-admin can raise, and the primary mint path signs with a single hot key.

*Remediation:* Disclose these trust assumptions to BoT (§8). Adopt a `TimelockController` (e.g. 24–48h) as upgrade/admin authority so changes are publicly visible before taking effect; consider an on-chain daily mint cap; separate the upgrade admin from operational roles.

#### H3 — MINTER and BURNER granted to the same hot worker key
**Confirmed.** `packages/contracts/scripts/grant-minter-role.ts:47,56` grants both roles to one EOA; `executeMint.ts:118` signs with the hot `MINTER_PRIVATE_KEY`. Because `burn(from, …)` destroys any account's balance, one compromised worker key can both mint unbacked tokens and burn arbitrary user balances, with only the off-chain daily cap as a backstop (which does not constrain burns).

*Remediation:* Do not co-locate MINTER and BURNER; keep BURNER behind the Safe or a separate scoped signer; move signing to an HSM/MPC/KMS-backed signer; add an on-chain mint rate-limit if issuance is automated.

#### H4 — No separation of duties: one admin can supply both approvals and force an unbacked mint
**Confirmed.** Burn: `backstage/burns/page.tsx:105-144` sets `secondApprovedByUserId = dbUser.id` **without checking it differs from `approvedByUserId`**. Deposit: `backstage/minting/page.tsx:234-288` is reachable by `super_admin` **or** `bank_admin`, writes a single `platform` approval, and flips a deposit to `mint_pending` (→ auto-mint) with **no fiat verification and no current-status check**. The `deposit_approvals.bank` approval described in the schema/docs is **never written anywhere** — the "dual approval" control is vestigial.

*Impact:* A single compromised/rogue admin can push a large burn through both gates (paying fiat to an attacker phone) or force an un-paid deposit to mint **unbacked** nTZS. Directly contradicts `docs/01 §6`, `docs/03 §11`, `docs/05 §3.9`.

*Remediation:* Reject a second approval when it equals the first approver; enforce **distinct roles** (bank vs platform) rather than "any admin twice"; require `approveDepositAction` to verify PSP/fiat confirmation and a valid predecessor status.

#### H5 — Sandbox caps are bypassed on the LP, consumer-withdraw, and enterprise-disbursement paths
**Confirmed.** Caps live in `lib/sandbox/limits.ts` but are only called by `api/v1/deposits/route.ts` and `withdrawals/route.ts`. Not called by `simplefx/api/lp/mint/route.ts` (its own bound `FX_LP_MAX_DEPOSIT_TZS` defaults to **10,000,000** = 10× the BoT per-tx cap), `app/user/withdraw/actions.ts`, or `backstage/enterprise/disbursements/[id]/approve/route.ts`. An LP can mint 100×900,000 = 90,000,000 TZS/day vs the 2,000,000/user/day cap. Reserve stays 1:1 (fiat still required), so this is a **regulatory** breach, not a backing break.

*Remediation:* Enforce `checkPerTransactionCap` + an atomic per-user period counter on **every** on/off-ramp entry point.

#### H6 — Standalone worker's daily-cap check ignores the amount already issued
**Confirmed in code; latent today.** `apps/worker/src/index.ts:57-63` checks `reserved_tzs + amount ≤ cap`, omitting `issued_tzs`. After each mint commits, `reserved_tzs` returns toward zero, so the platform 100,000,000/day cap degrades to a *concurrent-in-flight* limit only. `executeMint.ts:105` has the correct check (`reserved + issued + amount ≤ cap`) — the two mint engines disagree. `settlement.ts:6-9` says the worker "is not deployed," so this is latent until `apps/worker` runs.

*Remediation:* Change the worker predicate to include `issued_tzs`; consolidate the two engines onto one shared, tested reservation function.

#### H7 — Off-ramp revert (`force_revert`/`mark_completed`) re-mints with no idempotency
**Confirmed.** `api/admin/burns/[id]/reconcile/route.ts:96-171`; `revertOffRampBurn.ts:66` mints unconditionally ("idempotency is the caller's responsibility"). The `auto` branch guards on `payoutStatus='reconcile_required'`, but `force_revert` and `mark_completed` have **no guard** — calling twice re-mints twice; reverting after a payout genuinely completed gives the user fiat **and** tokens.

*Remediation:* Gate both branches on a non-final `payoutStatus` and perform the same atomic `reverting` claim used by the inline/webhook callers.

#### H8 — SimpleFX "viewer" (read-only) role can withdraw LP funds directly
**Confirmed.** `lib/fx/approvals.ts:13-15` — `needsApproval(role)` returns true **only** for `role === 'operator'`; `simplefx/api/lp/withdraw/route.ts:33-36` queues for approval only when `needsApproval` is true, otherwise executes directly. Every other role — including `viewer` (an invitable role) — falls through to direct `executeWithdraw()` to an arbitrary `toAddress`. Same inverted gate on `fx-config` (PUT) and `banking` (PUT).

*Impact:* An LP invites an accountant as `viewer`; the viewer signs in and `POST`s a withdrawal that moves funds on-chain immediately, and can silently rewrite spreads and bank/trust-account details.

*Remediation:* Replace the inverted predicate with a positive allow-list (`canActDirectly` / `canWrite`) — owners/approvers act, operators queue, **viewer is denied (403)** — applied on every mutating LP route.

#### H9 — No session/role revocation across the custom auth systems
**Confirmed.** `lib/fx/auth.ts:37-48` reads `role`/`memberId` straight from a 7-day JWT and never re-checks `lpMembers.status`; removal only sets `status='disabled'`. Merchant/enterprise use 30-day stateless tokens; `set-password` does not invalidate outstanding sessions. A fired operator/approver keeps working — and, combined with H8, keeps withdrawing — for up to the token lifetime.

*Remediation:* Re-load the member/user by id on each authenticated request, authorize on the **DB** role/status, and add a `tokenVersion` (or "sessions-invalidated-at") bumped on removal/role change/password reset. Shorten money-surface lifetimes.

#### H10 — Stored XSS via the merchant image proxy (attacker-controlled `Content-Type` on a `data:` URI)
**Confirmed.** Sink `api/merchant/image/[id]/route.ts:25-39`; source written with only `.trim()` at `merchant/api/merchant/links/route.ts:28` and `api/v1/biashara/links/route.ts:38`. The public, unauthenticated route reads the merchant-controlled `imageUrl`; for a `data:` URI it parses the MIME from the URI header (no allowlist) and streams the bytes back with that `Content-Type` **on the app's own origin**, with no `nosniff`/CSP. This URL is advertised as the OpenGraph/Twitter image.

*Exploit:* Merchant sets `imageUrl = "data:text/html;base64,…<script>…"` (or a scripted `image/svg+xml`); visiting `/api/merchant/image/<id>` executes attacker JS on the app origin → session/CDP-token theft.

*Remediation:* For `data:` URIs, restrict the served `Content-Type` to a raster-image allowlist and never echo the user MIME; add `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: default-src 'none'`; validate `imageUrl` at write time. (Related: M-level open redirect on the non-`data:` branch, `:42`.)

#### H11 — Vulnerable dependency base (89 advisories, 2 critical) and no CI/CD security gate
**Confirmed (live `npm audit`).** Totals: 2 Critical, 24 High, 49 Moderate, 14 Low. Notable **direct** dependencies: `jspdf@4.2.0` (**Critical** — PDF/HTML injection into generated receipts/statements), `better-auth ≤1.6.1` via the **beta** `@neondatabase/neon-js` (**Critical** — 2FA bypass, OAuth state-confusion, rate-limit bypass on the auth anchor), `drizzle-orm@0.44.7` (**High** — SQL injection via identifiers, on the ledger ORM), `next@16.1.1` (**High** — Server-Actions CSRF bypass, request smuggling, DoS), `ethers`/`viem` (vulnerable `ws` in the signing path), `nodemailer@8.0.4` (SMTP/CRLF injection on OTP mail), `axios` (SSRF/credential leak). **There is no CI/CD at all** — no dependency review, SCA/`npm audit` gate, secret scanning, or test gate, despite an existing (unrun) Hardhat suite.

*Remediation:* Emergency-patch the two criticals and the direct highs (`drizzle-orm ≥0.45.2`, `next 16.3.x`, `ethers`/`viem`, `nodemailer >9`, `jspdf >4.2.0`); pin exact versions on signing/auth/DB libs; drop unused multi-chain SDKs (`tronweb`, `@hyperbridge/sdk`) if Base-only; stand up CI with an `npm audit --audit-level=high` gate, dependency review, secret scanning (gitleaks + push protection), lint/typecheck, and the contract tests, all required by branch protection.

### 5.3 Medium

- **M1 — No rate-limiting / lockout on password logins.** `api/v1/partners/login`, `enterprise/.../login`, `merchant/.../login` verify scrypt correctly but apply no throttle; `enforceRateLimit` exists but is only wired to swaps. Partner login controls treasury withdrawals. *Fix:* rate-limit keyed on email + IP with lockout. (OTP flows are properly hardened.)
- **M2 — Debug endpoints unauthenticated and leaking.** `api/debug/db` calls `neonAuth()` but never enforces it — leaks DB host/name and `users` row count; `api/debug/snippe` returns the **platform PSP float balance**; `api/debug/onchain` is an RPC amplifier. *Fix:* delete or gate behind `super_admin` + 404 in prod.
- **M3 — Unauthenticated legacy receipt leaks payer PII unmasked.** `api/receipt/[depositId]` returns `payerName` **and** `payerPhone` in the clear; the v1 sibling masks the phone. *Fix:* mask/gate as the v1 route does.
- **M4 — Unauthenticated oversight report over-exposes.** `api/oversight/reserves-report` returns the 20 most-recent deposits with `pspReference`/amount/txHash, KYC pipeline counts, and issuance internals. *Fix:* public feed returns aggregate supply/reserve only; gate the rest behind roles / `bot_regulator`.
- **M5 — Unauthenticated AI-chat cost abuse.** `api/v1/ai/chat` invokes Anthropic (+ Tavily) with no auth/rate-limit — a free LLM/search proxy on the platform's budget. *Fix:* require a session + rate-limit.
- **M6 — S2S tenant asserted by a client header under one shared secret.** All `api/v1/biashara/*` and `api/v1/enterprise/{disbursements,accounts}/*` authenticate only with `NTZS_SERVICE_KEY` (timing-safe, good) then scope to a request-supplied `x-merchant-id`/`x-enterprise-id`. Key compromise → cross-tenant money movement (`financing/withdraw` off-ramps *any* merchant to an attacker phone). *Fix:* bind tenant to credential (per-tenant keys or HMAC over the header), rotate, and reduce blast radius. (Not externally exploitable without the key — by design, but high-value.)
- **M7 — TOCTOU on per-user caps.** `lib/sandbox/limits.ts:44-135` reads `SUM()` then the caller inserts in a separate statement — concurrent requests each pass the same snapshot and collectively exceed the cap. *Fix:* atomic conditional counter (as done for the platform cap in `executeMint`).
- **M8 — Manual "Process Pending Mints" skips the daily cap.** `backstage/minting/page.tsx:37-156` mints then adds to `issued_tzs` afterward with no reservation check. *Fix:* route through the atomic reserve-then-mint path.
- **M9 — Poll crons ingest "completed" without an amount/currency cross-check.** `poll-snippe/azampay/zenopay` advance on status alone; the webhook path checks amount ≥ requested and currency == TZS. *Fix:* add the same check to the polls.
- **M10 — AzamPay webhook signature scheme is a guessed placeholder.** `lib/psp/azampay.ts:633-712` copies Snippe's scheme/headers/field paths (flagged `⚠` in-code). It fails closed today (no forgery), but risks go-live breakage (shifting all ingestion to the amount-unchecked poll path) and a careless "make it work" fix weakening verification. *Fix:* confirm AzamPay's real scheme + payload against the sandbox and pin with a test vector before `ACTIVE_MOBILE_PSP=azampay`.
- **M11 — CSV/formula injection in regulator-facing exports.** `backstage/simplefx/fills-export/route.ts:18-24` and `enterprise/.../disbursements/[id]/report/route.ts:63-69` — `csvEscape` doesn't neutralize a leading `= + - @ \t \r`. Attacker-controlled LP/contractor names execute as formulas when finance/BoT opens the CSV. *Fix:* prefix risky cells with `'`.
- **M12 — Blind SSRF via partner-controlled webhook URL.** `lib/waas/partner-webhooks.ts:107` fetches `event.webhookUrl` with no scheme/host/IP validation → can hit `169.254.169.254`/internal. *Fix:* require `https:`, block loopback/RFC-1918/link-local/metadata at set-time and delivery-time, disable redirects.

### 5.4 Low / Info (hardening)

- **L1** Internal endpoints (`api/internal/bot-config`, `api/internal/lp-deposit`) use non-constant-time `===` on `INTERNAL_API_SECRET` (fail-closed, but use `timingSafeEqual`).
- **L2** Merchant JWT secret falls back to `FX_JWT_SECRET` (`merchant/auth.ts:29`) — cross-domain key sharing; require a distinct secret, fail closed.
- **L3** `APP_SECRET` guard checks length ≥32 only; the 34-char `.env.example` placeholder passes it — reject known placeholders.
- **L4** Fund-manager initial password uses `Math.random()` (`backstage/savings/actions.ts:8-31`) — use `crypto.randomInt`.
- **L5** OTP codes / invite links printed to stdout when SMTP is unset (`fx/otp.ts:57`, `merchant/otp.ts:42`, `enterprise/otp.ts:40,71`) — gate behind `NODE_ENV!=='production'`.
- **L6** Inconsistent safe-mint threshold across paths (100,000 vs 1,000,000) — 100k–1M TZS deposits auto-mint on the webhook path but need Safe on the poll/legacy path. Centralize to the most conservative value.
- **L7** `confirmSafeMintAction` doesn't enforce `txHash` uniqueness across deposits — two same-wallet/amount deposits could be marked minted off one on-chain mint (favors reserve; corrupts reconciliation). Add a uniqueness constraint.
- **L8** Payment webhook binds only on `metadata.deposit_request_id`, not the stored `pspReference` — add `data.reference === deposit.pspReference`.
- **L9** `*_WEBHOOK_ALLOW_UNTIMED=1` body-only fallback removes replay freshness — remove for production.
- **L10** Weak amount validation on `api/v1/swap` (accepts negative/non-finite; unvalidated `slippageBps`).
- **L11** File-upload MIME is trusted from the client; KYB bytes served `inline` without `nosniff`; `partners/kyb/upload` writes to Vercel Blob with `access:'public'` — sniff content server-side, add `nosniff`, use private access + authenticated proxy.
- **L12** CORS `*` + `Allow-Credentials: true` on `api/auth/cdp-token` (browsers reject the combo; misleading — tighten).
- **L13** Internal error messages returned to clients (`api/v1/users/route.ts:217`, `withdraw/actions.ts`).
- **L14** Super-admin bootstrap by env-listed email (`syncNeonAuthUser.ts:22-30`) — restrict to one break-glass address; confirm Neon Auth enforces verified email.
- **L15** Second undocumented UUPS proxy `0xC7dE259B…f103` in `.openzeppelin/base.json`; the "V1→V2 upgrade" narrative is inaccurate (V1 is not upgradeable → V2 was a fresh deploy). Identify/decommission and correct the docs.
- **L16** Contract uses base `AccessControl` (not `AccessControlDefaultAdminRules`): renounce-footgun + single-step admin handoff, no on-chain 2-person rule. Thin contract tests (3, V2-only); OZ caret ranges + no contracts lockfile / `evmVersion` pin (bytecode reproducibility). Dead ZenoPay verification code with non-constant-time compare.
- **L17** Single `WAAS_ENCRYPTION_KEY` with no key-id/version in the ciphertext blob — no staged rotation.
- **L18** Docker base image `polytopelabs/simplex:latest` (mutable tag) in the market-maker, which holds live signing keys — pin by digest. Duplicate `apps/web/package-lock.json` — delete. Market-maker sends `INTERNAL_API_SECRET` over `http://` if misconfigured — refuse non-HTTPS.

---

## 6. What is already done well (do not regress)

These are genuine strengths and should be preserved and pointed to in the BoT submission:

- **Webhook money-in boundary is robust.** HMAC-SHA256 over the **raw** body, `crypto.timingSafeEqual` with length pre-check, fail-closed on a missing secret, 5-minute timestamp freshness (replay protection), and an amount/currency cross-check that rejects underpayment/wrong-currency. (`lib/psp/snippe.ts:655-711`)
- **Primary mint path is atomic.** `executeMint` claims `mint_pending→mint_processing` in one conditional `UPDATE` and reserves the daily cap race-free with a single conditional statement — no TOCTOU on the platform cap; concurrent webhooks/crons yield exactly one mint. (The double-mint risk is in the *retry/failed* paths, C1, not the happy path.)
- **Seed encryption is correct.** AES-256-**GCM**, fresh 96-bit IV per call, auth tag verified, 32-byte key — no ECB, no static IV, no nonce reuse. Seeds are stored encrypted at rest; no plaintext key column exists.
- **OTP is hardened.** `crypto.randomInt` codes, SHA-256 at rest, timing-safe compare, per-code attempt cap, per-email issuance throttle + cooldown.
- **WaaS object-level authorization is consistent.** `v1/{users,deposits,withdrawals,ramp}/[id]`, partner money routes, MM routes, and enterprise lender→merchant routes all re-scope to the authenticated principal — **no IDOR found**.
- **Admin/backstage RBAC** uses `requireAnyRole([...])` consistently and fails closed. **No secrets in git history** (144 commits swept); `.gitignore` correct; no `NEXT_PUBLIC_*` secret exposure. **SQL is parameterized throughout** (no injection found in app code). Passwords are scrypt+salt. Amount/precision handling uses integer `bigint` TZS with `BigInt` scaling (no float drift).
- **Burn-before-payout with rollback** on treasury/user withdrawals, idempotency keys on withdrawal, and on-chain `Transfer(0x0→wallet)` verification before marking safe-mints `minted`.

---

## 7. Remediation roadmap (mapped to the sandbox timeline)

**P0 — Before first user onboarding (blocking).**
1. Close the two unbacked-mint paths: **C1** (mint-retry idempotency) and **C2** (treasury-remint idempotency + no metadata trust). Strategic: add an **on-chain per-deposit idempotency key** to `mint()` — closes both at the token level.
2. Fix **C3** cron auth (fail-closed, drop `x-vercel-cron`, timing-safe, central helper).
3. Resolve **C4** (rotate + fail-closed CDP key) and **verify §8 runtime facts**.
4. Resolve the admin-custody question **H1** on-chain; move minting to a policy/HSM/MPC signer or complete the `mint_requires_safe` flow; separate MINTER/BURNER (**H3**); disclose **H2** centralization to BoT.
5. Enforce separation of duties and real dual-approval-with-fiat-check (**H4**); enforce caps on **all** issuance paths (**H5, H6, M7, M8**).
6. Emergency-patch the critical/high dependencies and **stand up CI** with security gates (**H11**).
7. Fix **H8** (viewer withdraw), **H9** (revocation), **H10** (stored XSS), and the unauthenticated data-leak endpoints (**M2, M3, M4**).
8. Commission the **independent third-party smart-contract audit** and an **application penetration test** (both required by the sandbox parameters).

**P1 — During sandbox operation.**
- Rate-limit logins (**M1**); harden S2S tenant binding (**M6**); confirm/pin AzamPay webhooks (**M10**); fix CSV injection (**M11**) and SSRF (**M12**); clear the Low/Info backlog.
- Introduce `middleware.ts` central authorization; consolidate the five auth stacks; adopt a managed secret store with rotation.
- Automate the security-invariant monitors (§ below) with alerting; independent monthly reserve attestation; BCP/DR test.

**P2 — Scale-out.**
- Timelock on upgrades; on-chain mint cap; SOC 2 Type II window; bug bounty; formal verification of token invariants; quarterly stress tests.

---

## 8. Must verify against production and disclose to the regulator

These are unresolved because they depend on production runtime / on-chain state not readable from the review environment. Each must be checked **immediately** and, where relevant, disclosed truthfully to BoT.

1. **Is `CDP_JWT_PRIVATE_KEY_JWK` set in production?** If not, C4 is actively Critical (rotate now).
2. **Is `0xB2b8…C503` a Gnosis Safe or an EOA?** `eth_getCode` + `hasRole(DEFAULT_ADMIN_ROLE,…)`. This determines whether the multisig control described to BoT actually exists (H1).
3. **Is `CRON_SECRET` set in every environment?** (C3 fail-open.)
4. **Is `apps/worker` deployed?** If yes, H6 is live, not latent.
5. **Is `ACTIVE_MOBILE_PSP=azampay` yet?** (M10 — do not flip until the webhook scheme is verified.)
6. **Reconcile documentation with code before submission.** The following are described to BoT but not enforced in code and must be corrected or implemented: dual-approval-before-every-mint, "high-value mints require the Safe," per-mint on-chain caps, multisig-only admin, and the auditor check "`deposit_approvals` exists for every minted deposit." Shipping the current docs to BoT as-is is a **misrepresentation risk**.
7. **Confirm the deployed implementation bytecode** at `0x4a9360…` reproduces from pinned sources and matches Basescan; identify and decommission the second proxy `0xC7dE…` (L15).

---

## 9. Closing

The nTZS codebase reflects a capable team and a largely sound application-security baseline. The risk is concentrated in a small number of high-impact issuance/governance defects and in the gap between the controls described to the regulator and those enforced in code. The P0 list is achievable and, once closed and independently audited, would put the platform on defensible footing for the BoT sandbox. Section 8's verification items should be actioned today — several change the severity of the findings above.

*This assessment is an internal readiness review and does not replace the independent third-party smart-contract audit and penetration test required by the sandbox.*
