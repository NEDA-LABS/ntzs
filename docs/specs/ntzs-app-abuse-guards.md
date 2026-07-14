# nTZS App-Side Abuse Guards — Design Note (Internal)

**Status:** Proposed — not yet implemented
**Date:** 6 July 2026
**Companion to:** [selcom-security-controls.md](./selcom-security-controls.md) (the Selcom-facing asks). Selcom's Transaction Rules are one layer; this note is **our** layer, so neither side is a single point of failure.

---

## Threat model

| # | Threat | Vector |
|---|--------|--------|
| T1 | Salami drain | Many payouts, each under the per-transaction cap, via stolen API creds or a compromised app path |
| T2 | DoS / flooding | Volumetric or app-level floods on public endpoints (deposit, withdraw, pay, webhooks) |
| T3 | Replay / double-redeem | Re-submitted redeem requests or replayed PSP callbacks causing double payout or double mint |
| T4 | Self-DoS | Our own retry logic hammering the PSP during an outage |
| T5 | Forged mint/burn triggers | Spoofed callbacks to the (future) Selcom `/mint` `/burn` endpoints |

## Guards

### G1. Per-user redemption velocity limits (T1)
Enforce in the withdrawal path (`apps/web/src/app/app/user/withdraw/actions.ts` and `api/v1/withdrawals`), **before** any burn/payout is initiated:

- Per-user: max amount/day and max count/day (e.g. 3 withdrawals, aggregate cap tiered by KYC level).
- Global: max total payout amount + count per hour/day across all users — mirror the numbers agreed with Selcom so ours trip **first**.
- Implementation: SQL aggregate over `withdrawal`/`burn` tables in the same transaction that inserts the request (no new infra); index on `(userId, createdAt)`.

### G2. Rate limiting on public endpoints (T2)
- Per-IP + per-user token bucket on deposit/withdraw/pay actions and all `api/webhooks/*` + future `api/v1/*` partner routes.
- Vercel serverless has no shared memory → use a shared store: Upstash Redis (`@upstash/ratelimit`) or a Postgres counter table if we want zero new vendors. Start: 10 req/min per user on money endpoints, 60 req/min per IP elsewhere; return 429.
- Enable Vercel's WAF/attack-challenge for the volumetric layer.

### G3. Circuit breaker on disbursements (T1, T4)
A single kill switch + auto-trip, checked by every payout initiation (withdraw action, burn worker `apps/worker/src/burn-worker.ts`, treasury withdraw route):

- **Manual:** `DISBURSEMENTS_PAUSED=1` env/DB flag — ops can halt payouts instantly.
- **Auto-trip:** if trailing 1h payout volume or count > ~3× the 7-day same-hour baseline, or on N consecutive PSP failures, set the flag, queue (don't reject) redemptions, and alert.
- Fail-safe direction: when in doubt, **stop paying out**; queued burns resume after manual review.

### G4. Idempotency on redeem + callbacks (T3)
- Client-supplied idempotency key on redeem requests (unique index; duplicate → return the original request, not a new one).
- PSP callbacks: unique index on `(provider, pspReference)` for processed events — a replayed webhook becomes a no-op. We already confirm-by-poll before acting (Selcom callbacks are unsigned); dedupe closes the other half.
- One payout per burn record enforced at the DB level (unique constraint), not just in code.

### G5. Mint/burn trigger hardening (T5)
For the future `api/webhooks/selcom/*` handlers:
- Verify signature (once Selcom ships it) **and** source-IP allowlist at the edge (Vercel middleware) so floods are dropped before any work.
- Never mint on the callback alone: confirm settlement via `GET /v1/transaction/query` (`confirmPayout()` pattern already in `apps/web/src/lib/psp/selcom.ts`), then mint exactly the settled amount, deduped by `reference_id`.
- Post-action invariant: assert on-chain supply == reserve balance (existing reserve-invariant banner / SupplyReconciliationCard machinery); alert + auto-pause on drift.

### G6. Monitoring & alerts (all)
- Alert on: velocity-limit trips, circuit-breaker trips, 429 spikes, callback signature/IP rejections, reserve-invariant drift, PSP balance below float threshold.
- Cheapest start: a cron that evaluates these from the DB and posts to Slack/email; graduate to real-time later.

## Rollout order

1. **G4** (idempotency/unique constraints) — pure DB migrations, prevents the worst outcomes, no product impact.
2. **G3** manual kill switch — trivial, huge operational value.
3. **G1** per-user + global velocity limits.
4. **G2** rate limiting (needs the Redis-vs-Postgres store decision).
5. **G3** auto-trip + **G6** alerting.
6. **G5** lands with the Selcom collections/webhook integration.

## Open decisions

- Rate-limit store: Upstash Redis (simple, new vendor) vs Postgres counters (no new vendor, more code).
- Velocity numbers per KYC tier — need expected volume figures.
- Where the circuit-breaker flag lives: env var (redeploy to clear) vs DB row (instant toggle, needs an admin UI switch in backstage). Recommend DB row surfaced in backstage/treasury.
