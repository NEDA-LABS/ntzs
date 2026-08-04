# SimpleFX Bank-LP Participation — Funding, Custody & Routing

**Status:** Design — accepted, pending build · **Phase 1.5** (between today's shared solver and the Phase 2 non-custodial vaults)
**Date:** 4 August 2026
**Related:** [`SimpleFX-Phase2-Custody-Migration.md`](./SimpleFX-Phase2-Custody-Migration.md) (custody end-state) · [`02-DEPOSIT-TO-MINT-LIFECYCLE.md`](../02-DEPOSIT-TO-MINT-LIFECYCLE.md) · [`09-WAAS-PARTNER-API.md`](../09-WAAS-PARTNER-API.md)

---

## 1. Context

A bank partner (first: **Selcom Microfinance**, testing ahead of go-live) wants to participate in SimpleFX with real inventory. Today they can't:

- `accountType='bank'` renders a **rate-setter portal only** — `Deposit`, `Withdraw`, `Swap`, `Positions`, `Rebalance` all carry `hideForBank: true`. The bank sets an FX rate and views settlements; it never holds tokens.
- Standard LPs fund a wallet → activate → their tokens are **swept into one shared solver EOA** → fills are paid from that EOA → deactivate returns them.

The shared solver is both **commingled** and **NEDA-keyed**. July 2026 proved the failure modes: an inventory-blind fill clamped an LP's ledger debit at zero and drained ~3,056 nTZS of *another* LP's capital, and a separate incident stranded an LP's exit for two days. A retail LP's own trading capital is one risk appetite; a regulated bank's reserve is another.

This ADR defines how a bank funds, holds, and trades **now** — in a way that lands exactly on the Phase 2 non-custodial design rather than needing rework.

---

## 2. Decisions

### D1 — A bank funds by **issuance request**, not a crypto deposit

nTZS does not exist until it is minted against verified fiat. Banks hold shillings, not tokens; a "deposit nTZS" button would presuppose tokens they have no legitimate way to hold. Instead the bank proves fiat arrived in trust and requests issuance against it.

This is not new machinery. **PR #227 (3 Aug 2026)** shipped bank-transfer collections: an intent generates a reference token (`NTZ-XXXXXX`, ambiguous glyphs excluded), the payer puts it in the transfer narration, and `selcom-statement-sync` matches the credit by **token + exact amount** inside a 72-hour intent-first window (`SELCOM-BANK` channel). Institutional funding is that same rail with an approval wrapper and a different mint destination.

### D2 — Bank inventory lives in a **segregated per-bank vault**, never the shared pool

Each bank gets its own on-chain address. **The vault's chain balance *is* the position** — there is no `lp_pool_positions` row to drift from it, and an over-payout cannot silently clamp: the ERC-20 transfer itself reverts. The entire class of bug that hit us in July becomes structurally impossible for bank funds.

### D3 — **One router, N liquidity sources**

Separate the *money*, not the *brain*. The router ranks shared-pool LPs and bank vaults together on price. Inventory eligibility is checked per source — pool LPs against `lp_pool_positions`, vaults against `balanceOf(vault)`. `executeSwap` already takes `solverAddress` / `solverPrivateKey` as **parameters**; routing to a vault is passing a different pair, not an engine rewrite.

### D4 — Vaults are the **bridge to Phase 2**, not a detour

Phase 2 makes the vault a bank-owned Safe with a swap-only operator key, removing NEDA's custody liability. Because each bank already holds a distinct address, Phase 2 becomes *"change who owns this address"* — a per-bank decision, executable without touching the shared pool or other banks. Commingled funds could never offer that.

### D5 — Fiat legs use the **existing bank rails**

Collections: `SELCOM-BANK` via TIPS (#227). Payouts: `sendBankPayout` is implemented by **Selcom, AzamPay and Snippe**, and is live in the partner API (`bankCode` + `accountNumber`, gated by `SELCOM_DISBURSEMENTS_ENABLED`). No new PSP work — this is UI exposure plus an approval wrapper.

### D6 — Both money directions pass **dual control**

Funding and redemption route through the existing maker-checker approvals engine (`set_fx`, `set_banking`, `withdraw` today): the bank's operator raises, the bank's approver signs, and NEDA verifies before minting or releasing. Two organisations sign every movement of institutional money.

---

## 3. Mechanics

### 3.1 Funding — TZS in, nTZS to the vault

```
Bank operator        Bank approver        Real world            NEDA                Chain
─────────────        ─────────────        ──────────            ────                ─────
request 50M TZS ──►  approves       ──►   wire w/ NTZ-4K2P9X ──► statement-sync   ──► mint 50M nTZS
(portal)             (their Approvals)    to trust account      auto-matches         → bank vault
                                          (72h window)          + admin confirms     (capped, attested)
```

1. **Request** — the bank's Reserve page takes an amount, shows their registered trust-account details (captured at the "Banking & reserve" onboarding step) and issues a reference token. Row created; no money, no tokens.
2. **Bank approval** — lands in their own Approvals tab beside `set_fx`. Their internal controls bind before we ever see it.
3. **Fiat moves** — a real interbank transfer carrying the reference in the narration. The one step software must not fake.
4. **Match & verify** — `selcom-statement-sync` matches token + exact amount automatically; an admin confirms the institutional issuance in the Backstage minting queue. Ambiguity → manual review, never an auto-mint.
5. **Mint** — the existing minter mints **to the bank's vault address**, inheriting `DAILY_ISSUANCE_CAP_TZS`, the real tx hash, and the attestation's supply-vs-reserves math.

### 3.2 A fill against a bank vault

Taker swaps 1,000 USDC → nTZS; Selcom's 0.27% ask wins the ranking:

| Step | Today (pool LP) | Bank vault |
|---|---|---|
| Eligibility | `lp_pool_positions.contributed ≥ payout` | `balanceOf(vault) ≥ payout` |
| In-leg | taker → shared solver | taker → **Selcom vault** |
| Out-leg | shared solver → taker | **Selcom vault** → taker *(vault key signs)* |
| Accounting | double-entry debit/credit + clamp guard | **none needed — the balance is the book** |
| Fee | surplus in pool, swept later | surplus in vault, swept later |

An `lp_fills` row is still written for attribution, earnings and audit. The bank competes on price alone — the router neither knows nor cares that a source is a bank.

### 3.3 Inventory management and redemption

Two-way quoting self-balances: selling nTZS fills the vault with USDC, which then backs the buy side. When it skews, the bank either **issues more** (§3.1) or **settles out**: request → bank approver → burn nTZS from the vault → release TZS from trust via `sendBankPayout`, same reference discipline. Supply and reserves move together; the peg holds by construction.

---

## 4. What exists vs what to build

| Capability | State |
|---|---|
| Bank-transfer collections (`SELCOM-BANK`, reference tokens, auto-match) | ✅ live (#227) |
| Bank payouts (`sendBankPayout` — Selcom / AzamPay / Snippe) | ✅ implemented, live in partner API |
| Retail **deposit** by bank transfer | ✅ live (#227) |
| Maker-checker approvals engine | ✅ live |
| Minting queue, issuance cap, attestation | ✅ live |
| Retail **withdraw** to bank | ❌ mobile-money only in the consumer UI |
| SimpleFX deposit / withdraw by bank (bank **and** standard LPs) | ❌ not exposed |
| Vault registry + vault-aware routing | ❌ new |
| Bank Reserve page (fund / settle out) | ❌ new |

The genuinely new code is small: a vault registry (address, key path, owning bank), the router treating vaults as sources, and the bank Reserve page. Everything else is exposure of rails that already work.

---

## 5. Consequences

**Positive**
- Bank funds cannot be drained by another LP's fill — enforced by the chain, not by ledger discipline.
- Deep liquidity becomes possible; the pool is ~15k nTZS today.
- Every bank nTZS is born from a verified trust credit, so reserves ≥ supply holds by construction — a clean paragraph for the BoT sandbox report.
- Reconciliation gets *easier*: per-vault invariant is one balance comparison.

**Negative / accepted**
- One hot key per vault until Phase 2 (same HD custody model as today's LP wallets — marginal added ops, and the enabler for per-bank Safe upgrades).
- No split fills initially: a swap must fit one source's inventory, as it does today per-LP. Immaterial at bank scale; a later optimisation if ever needed.
- The two-transfer non-atomicity (input landed, output failed) is unchanged from today; the `fx-pool-reconcile` cron remains the net under it.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Custody question** — "who can move our money?" is *NEDA* until Phase 2 | Disclose plainly; cap sandbox amounts; per-vault Safe upgrade is a per-bank switch |
| Vault key compromise | Blast radius is one bank; Phase 2 reduces the operator key to swap-only |
| Sandbox caps — bank funding dwarfs the 1M TZS per-txn parameter | Institutional issuance is not a consumer transaction; classify explicitly with BoT before real volume |
| Unmatched / ambiguous wire | 72h window, exactly-one-token + exact-amount rule, else manual review (#227 behaviour) |
| Test accounts touching real rails | Sandbox issuance capped and TEST-badged; `test_access_until` already gates portal access |

---

## 7. Open questions

1. Vault key custody in Phase 1.5: platform HD (fastest) vs Safe-from-day-one for the first bank (slower, but skips a migration).
2. Do bank vaults quote a *separate* spread from their pool-LP spread, or one book per account?
3. Does institutional issuance count against sandbox participant caps? (BoT conversation, not code.)
4. Fee sweep from vaults: same treasury path, or netted into the bank's settlement?

---

## 8. Build sequence

1. **Fiat-rail UI exposure** — bank deposit/withdraw buttons on SimpleFX (bank + standard) and bank withdraw on retail. Pure exposure of live rails; ships independently and is useful immediately.
2. **Vault registry + routing** — vaults as router sources behind a flag; shadow first.
3. **Bank Reserve page** — funding request → approvals → Backstage verify → mint to vault.
4. **Recon extension** — per-vault invariant + multi-address transfer sweep.
5. **Phase 2 hand-off** — first bank vault migrates to a bank-owned Safe per the custody doc.
