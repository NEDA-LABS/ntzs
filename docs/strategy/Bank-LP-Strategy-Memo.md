# Bank-LP & Settlement Strategy — Internal Memo

> **CONFIDENTIAL — INTERNAL ONLY.** Not for distribution to BoT, partners, or the product surface. This memo holds the commercial and architectural strategy behind the regulator-facing documents; only the issuance/redemption protocol and risk plan are shared externally.

**Owner:** [Victor / NEDA LABS] · **Version:** 0.1 · [date]

---

## 1. Thesis

Banks won't be "stablecoin LPs" and shouldn't be asked to pre-fund stablecoins — they already do nostro/correspondent and won't take a worse version of it. Under the BoT sandbox the bank's role is what it's *already licensed for*: **TZS reserve custody (ring-fenced trust) + FX conversion + TZS settlement + AML**. The stablecoin stays on our side of the line.

The product innovation is a **decoupled settlement clock**: cross-currency value moves as an instant on-chain `nTZS ↔ USDC` swap (seconds), while the regulated reserves (TZS trust, USD nostro) **net behind it**. That collapses a T+2, pre-funded, opaque correspondent corridor into a seconds-long, net-settled, provable one — "tokenised correspondent banking / on-chain nostro netting" — without nTZS ever becoming a parallel currency or leaving the reserve-backed, TZS-settled perimeter.

## 2. Custody architecture (the liability we remove)

Today's solver pool is a NEDA-controlled EOA holding commingled funds — the custody liability we must not extend to bank capital. Target end-state:

- **nTZS float:** issued by NEDA 1:1 against TZS in the bank's trust. On-chain TZS liquidity.
- **USDC float:** held **offshore** by a VASP; sourced 1:1 via Circle Mint; never held domestically.
- **Swap:** atomic **DvP** at the bank's FX rate — no party holds the other's instrument beyond settlement; no NEDA-held key can move bank funds.
- **Bank:** FX principal + reserve trustee; sets the rate; absorbs FX from its own book on **net settlement**, not pre-funded.

Net effect: the bank's money is never in a NEDA wallet; our key can (at most) execute swaps within bank-set bounds, never withdraw.

## 3. USDC sourcing & the two floats

- **Where USDC comes from:** Circle Mint (USD↔USDC, 1:1, regulated) as primary; OTC/exchange as backup and for USDT. Funded by the USD the bank's FX desk provides.
- **Real-time without locked capital:** a small working USDC float delivers on-chain instantly; replenished asynchronously in batches; **inbound nets against outbound**, so we only ever source the net imbalance.
- **FX risk** sits only on TZS↔USD (the bank's). USD↔USDC is dollar-to-dollar, so USDC over USDT (stronger peg, direct mint).

## 4. Offshore VASP — option A vs B (decision pending)

| | **A — Own affiliate** | **B — Third-party VASP** |
|---|---|---|
| Control / margin | Full | Partial (their spread) |
| Speed to launch | Slower (license a VASP) | Fast |
| Upfront capital / overhead | High | Low |
| Regulatory optics | Related-party — needs framing | Cleanest — arm's-length |
| Counterparty risk | None (in-group) | Dependency on the firm |
| Strategic moat | Strong (in-house) | Weaker (shared flow) |

**Recommendation — phased:** lead with **B** for the sandbox (cleanest optics, fast, no foreign VASP to stand up for a 3–12 month test, a named licensed firm strengthens the BoT submission); **graduate to A** post-sandbox once volume and economics justify owning the stack. "Rent the rail to prove it, own it once it's real." Go straight to A only if day-one control of economics/IP is non-negotiable and there's appetite to license now.

## 5. Portal: reuse, don't rebuild

The SimpleFX engine already is, feature-for-feature, a bank FX/treasury terminal. ~80% reuse:

| Existing capability | Bank-model role | Change |
|---|---|---|
| Position tracking (`lpPoolPositions`) | the two floats | reuse; re-point balances |
| Spread `bidBps/askBps` | bank "sets FX" | reuse; relabel *FX rate/margin* |
| Swap engine + `lpFills` | DvP settlement + fills | reuse now; venue changes in Phase 2 |
| `fx-pool-reconcile` monitor | 1:1 reserve dashboard | reuse; point at trust ↔ supply |
| activate/deactivate (concurrency-safe) | fund/withdraw float | reuse |
| transactions page | statements | reuse; relabel |
| OTP auth + `onboardingStep` | auth + onboarding state | keep; build flow on top |
| solver EOA custody | DvP/vault + offshore USDC | **Phase 2** |
| — | maker-checker roles | small new build |

## 6. Onboarding (first product change)

Keep OTP as the auth primitive; wrap a guided journey on top, driven by the existing `onboardingStep`:

- **Sign-up** (not only sign-in): entity details + account type — *Bank partner* vs *Standard LP* — so the flow branches.
- **Bank path:** KYB → designate **operator + approver** (maker-checker = the internal-controls requirement) → trust-account + FX parameters → sandbox test → go-live, as a stepper with progress.
- **Role-based access** (operator sets, approver authorises). Contained build; big trust signal.

## 7. Migration roadmap

- **Phase 1 — sandbox (now):** keep the solver pool. Onboard the bank as reserve+FX partner; re-point the reconcile monitor as the 1:1 reserve dashboard; ship the onboarding flow and banking-language relabel. Minimal engineering; proves the model to BoT.
- **Phase 2 — scale (post-sandbox):** swap custody underneath — solver EOA → DvP/vault; move the USDC float fully to the VASP; the dashboard reads on-chain balances; bring on the audited third-party VASP (and/or stand up the affiliate per §4). Tracking UI unchanged.

De-risks the sandbox by not migrating custody and proving a regulatory model at the same time.

## 8. What stays internal vs. regulator-facing

- **External (BoT / counsel):** issuance & redemption protocol, risk management plan, reserve-dashboard spec.
- **Internal only (this memo):** custody architecture rationale, VASP A/B economics, commercial/margin model, the migration roadmap, the competitive moat. Not embedded in the product UI, not shared with partners beyond what an agreement requires.

## 9. Open decisions

1. Offshore VASP: **affiliate (A) vs third-party (B)**, and **jurisdiction** (driven by Circle access + AML equivalence BoT accepts).
2. Partner bank selection (1–2 per the letter) and trust-account mechanics.
3. Commercial model: how FX margin + custody fees split across NEDA / bank / VASP.
4. Whether BoT must name/approve the offshore party in the Testing Environment Agreement (likely yes).
5. Smart-contract audit scope and timing for the DvP/vault (Phase 2 gate).

---

*Pair with: nTZS Issuance & Redemption Protocol, nTZS Risk Management Plan (both regulator-facing).*
