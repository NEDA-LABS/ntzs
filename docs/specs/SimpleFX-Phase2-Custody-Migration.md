# SimpleFX Phase 2 — Custody Migration Design

**Status:** Design draft (build *after* the sandbox) · **Version:** 0.1 · [date]
**Context:** Bank-LP rollout, Phase 2. Moves custody off the NEDA-controlled solver EOA to a non-custodial **DvP/vault** model with the **USDC float offshore**, *without* changing the dashboard/engine. Phase 1 (sandbox) keeps the solver pool as-is.

---

## 1. Goal & non-goals

**Goal:** remove the custody liability — NEDA must not hold a key that can move the bank's funds — while preserving the real-time (~seconds) swap UX and the existing tracking engine.

**Non-goals:** changing the dashboard's tracking logic, the spread/positions/transactions UI, or the user-facing swap experience. Those stay; only the *custody and settlement venue underneath* change.

## 2. Current state (Phase 1)

- A single **solver EOA** (`SOLVER_PRIVATE_KEY`, `chainConfig.solverAddress`) holds commingled liquidity for all LPs.
- `executeSwap` (`lib/fx/swap.ts`) signs ERC-20 transfers from the solver to fill swaps.
- Activate sweeps LP wallet → solver; deactivate returns solver → LP wallet.
- `lp_pool_positions` is the **source-of-truth ledger** (now double-entry, post-fix); `fx-pool-reconcile` compares `Σcontributed + unswept fees` vs the solver's on-chain balance.

**Problem:** the solver key is NEDA-held and the funds are commingled — exactly the custody risk a bank will refuse, and the ledger can drift from chain (the class of bug already fixed once).

## 3. Target state (Phase 2)

| Leg | Where it lives | Who controls |
|---|---|---|
| **nTZS** | Issuance contract (mint/burn vs the TZS trust); nTZS held in the vault | NEDA mints/burns 1:1; bank holds the TZS reserve |
| **USDC** | **Offshore** at the VASP (Circle-sourced); never domestic | The VASP (see Bank-LP memo §4: affiliate vs third-party) |
| **Swap** | On-chain **DvP contract** — atomic `nTZS ↔ USDC` at the bank's signed rate | Fixed rules; NEDA/VASP deliver their own leg only |
| **Custody / withdrawal** | Vault owned by the bank (or its Safe) | **Bank** (`owner`); NEDA has a **swap-only** operator role |

**Key property:** the operator key can *only* call `swap()` within bank-set bounds; it **cannot withdraw**. Withdrawal/param changes are the bank's (`owner`). This is the non-custodial split from the bank-LP discussion.

### 3.1 Contracts

- **Vault / Safe** (per LP, segregated — not commingled): holds the on-chain balances; `owner` = bank (withdraw, set bounds, pause); `operator` = NEDA relayer (swap only).
- **DvP swap module**: executes an atomic `nTZS ↔ USDC` exchange at a **bank-signed price** within `[bounds]` + inventory caps; reverts on stale price.
- **Price feed**: bank-signed rate + staleness window (the bank stays FX principal; the contract just enforces its rate).

Implementation options (decide at build): (A) bespoke `FxVault` + DvP, or (B) bank-owned Gnosis **Safe** + a swap **module** + a scoped session key. Recommend **B** first (audited infra, the bank "owns a Safe"). Audit is a hard gate before real funds.

## 4. Engine changes (minimal)

- `executeSwap`: replace "sign ERC-20 transfers from the solver EOA" with "call `vault.swap(...)` via the operator key." Same single broadcast + 1-confirmation wait → **same ~10s latency**.
- `lp_pool_positions`: demote from source-of-truth to a **read-mirror** of on-chain vault balances. The double-entry fill logic can stay as a cache, or be dropped in favour of reading chain — TBD; either way the chain becomes authoritative, which **eliminates the drift/reconcile bug class**.
- Activate/deactivate: for the bank, "fund/withdraw" become vault operations the bank owns (not a NEDA sweep). The existing concurrency lock (`withLpOpLock`) still guards the orchestration.
- `fx-pool-reconcile`: re-point from `solver balance` to `vault balance ↔ trust ↔ token supply` (the §6 reserve dashboard).

## 5. Migration / cut-over (no money loss, no downtime)

1. **Deploy + audit** the vault/DvP contracts on Base (testnet → audit → mainnet).
2. **Stand up the offshore USDC float** at the VASP + Circle path; size the float (net intra-cycle imbalance + buffer).
3. **Provision the bank's vault/Safe**; bank takes `owner`, NEDA relayer takes `operator` (swap-only).
4. **Drain the solver into the new venue** in a controlled window: wind down solver positions (deactivate-style returns) and re-fund via the vault, or migrate balances by an audited transfer with reconciliation at each step.
5. **Flip `executeSwap`** to the vault path behind a flag (`FX_SETTLEMENT_VENUE = solver|vault`); run both in shadow first, then cut over per pair.
6. **Re-point reconcile + dashboard**; verify `delta = 0` against the new venue before enabling real flow.
7. **Decommission** the solver EOA once balances are zero and verified.

Cut over **per trading pair** and keep the flag so rollback = flip back to `solver`.

## 6. Risks & mitigations

- **Contract risk** → independent audit is a hard gate; start with Safe + module (audited base); limits + pause on-chain.
- **Migration value-loss** → reconcile at every step; move in small tranches; the existing safe-return + double-entry patterns carry over.
- **Stale price fills** → on-chain staleness guard; bank-signed feed.
- **Float starvation** → netting + async Circle replenishment; per-counterparty caps; alerting (reuse the drift-alert channel).
- **Operator key compromise** → worst case is swaps within the bank's own bounds; no withdrawal possible.

## 7. Dependencies / gates

1. Offshore VASP decision (affiliate vs third-party) + jurisdiction — Bank-LP memo §4/§9.
2. Smart-contract audit complete.
3. Partner-bank trust account + Safe/owner key live.
4. Sandbox (Phase 1) successfully concluded — don't migrate custody and prove the regulatory model at once.

## 8. Phasing within Phase 2

- **2a:** deploy + audit contracts; testnet shadow of `executeSwap` vault path.
- **2b:** move the USDC float to the VASP; bank vault provisioned; cut over per pair behind the flag.
- **2c:** decommission the solver; reconcile points only at the vault/trust; close out.

## 9. Open questions

1. Bespoke `FxVault` vs Safe+module (recommend Safe+module first).
2. Keep `lp_pool_positions` as a cache, or read chain directly as authoritative?
3. Per-LP vault vs a shared vault with on-chain per-LP accounting (single bank now → per-LP/single is fine).
4. Where the bank-signed price feed is produced + how often.
