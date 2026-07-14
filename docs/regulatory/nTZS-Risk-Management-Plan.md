# nTZS Risk Management Plan

**Prepared by:** NEDA LABS Company Limited
**For:** Bank of Tanzania — Fintech Regulatory Sandbox (Ref. LD.170/515/02/1254)
**Submission item:** §7(d) — Risk Management Plan, including the plan to manage the risk of issuing electronic money before receiving equivalent cash
**Status:** Draft for counsel / regulator review · *fields in `[brackets]` to be completed*
**Version:** 0.1 · [date]

---

## 1. Purpose

This plan identifies the principal risks of the nTZS sandbox test and the controls that mitigate them, with primary emphasis on the BoT-specified risk: **issuing electronic money before receiving equivalent cash** in the commercial-bank trust/escrow account.

## 2. Primary risk — issuance ahead of cash ("fake e-money")

**Risk:** nTZS is minted without the equivalent TZS first being received and ring-fenced, creating unbacked tokens.

**Controls:**

1. **Mint-after-cash, enforced technically.** The issuance service mints nTZS **only** against a confirmed PSP/bank deposit reference showing the equivalent TZS has settled into the trust account. There is no manual or open minting path.
2. **Single ring-fenced trust account** at [Partner Bank], segregated from operational funds; the bank confirms receipt before mint.
3. **Continuous reconciliation:** `TZS reserves` (bank balance) is reconciled against `nTZS issued` (on-chain supply) in real time; any divergence beyond [tolerance] triggers an automated alert and a mint freeze.
4. **Real-time reserve dashboard** giving BoT and the parties continuous visibility of reserves vs. tokens.
5. **Reserve attestations** from [Partner Bank] at [frequency].

**Invariant:** at all times `TZS reserves ≥ nTZS in circulation`.

## 3. Reserve integrity & peg

**Risk:** reserves are commingled, rehypothecated, or used to generate yield, weakening the 1:1 peg.

**Controls:** ring-fenced trust/escrow; no rehypothecation; **no staking or yield** on reserves or floats (consistent with §4 of the approval); reserves limited to cash + short-term government securities; redemption always honoured 1:1 in TZS.

## 4. Issuance/redemption operational risk

**Risk:** smart-contract error, key compromise, or a failed/duplicated mint or burn.

**Controls:** restricted mint/burn authority (§8 of the protocol); idempotent issuance keyed to the deposit reference; per-transaction and aggregate limits; pause/kill-switch; full on-chain audit trail; [independent smart-contract audit — status]. Key management: [HSM/MPC/custody arrangement].

## 5. Cross-currency / FX risk

**Risk:** FX exposure or settlement loss on the cross-border leg.

**Controls:**

- The **TZS↔USD FX is owned by [Partner Bank]** as principal; NEDA takes no FX position.
- The **USD↔USDC leg is dollar-to-dollar (~1:1)** and carries only stablecoin peg risk, mitigated by using **USDC (Circle, fully reserved)** as the primary asset and keeping the float small.
- The on-chain swap is **atomic (DvP)**, eliminating settlement/counterparty credit risk between the legs.
- All USDC activity is offshore at [Offshore VASP]; no foreign-currency stablecoin is held domestically.

## 6. AML / CFT

**Risk:** illicit funds enter or exit via the corridor.

**Controls:** KYC/AML at the **PSP** and **bank** for the TZS legs; KYB/KYC and transaction monitoring at **[Offshore VASP]** for the USDC leg; sanctions and PEP screening; the token set is restricted to **approved sandbox participants**; suspicious-activity reporting per applicable law. Core AML/CFT for customer funds rests with [Partner Bank] (letter §6).

## 7. Liquidity risk

**Risk:** insufficient float to settle a transaction promptly.

**Controls:** inbound/outbound flows **net** against each other, keeping floats small; float sizing = net intra-cycle imbalance with a [buffer]; asynchronous replenishment via Circle Mint (USD↔USDC) and trust top-ups; rate-staleness guard pauses swaps if pricing goes stale rather than filling at a bad rate; per-counterparty exposure caps.

## 8. Incident response, suspension & wind-down

- **Pause:** minting and/or swaps can be halted immediately by the parties or on BoT direction; redemptions remain available so holders are never trapped.
- **Escalation:** [contacts / SLA].
- **Wind-down:** on termination of the test, outstanding nTZS is redeemed 1:1 from the trust reserves and the token supply is retired to zero; the reconciliation report evidences full settlement.

## 9. Monitoring & reporting

- Real-time reserve dashboard (reserves vs. tokens).
- Continuous reconciliation with automated drift alerting to [recipients].
- Periodic reporting to BoT per the Testing Environment Agreement, including milestone-review packs before each phase.

---

*This plan is read together with the nTZS Issuance & Redemption Protocol (§7(c)).*
