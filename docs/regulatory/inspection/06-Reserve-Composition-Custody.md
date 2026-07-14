# nTZS — Reserve Composition & Custody

**Prepared for:** Bank of Tanzania — Pre-Testing On-Site Inspection
**Sandbox Ref:** LD.170/515/02/1254 · **Prepared:** 8 July 2026
**Owner:** Victor Muhagachi, CTO

Documents where the nTZS reserve is held, what it is composed of, and how the 1:1 backing is
demonstrated. Aligned to Testing Parameters 6 & 7.

## 1. Custody

- **Custodian:** Selcom Bank (Tanzania).
- **Account:** a single, **controlled, ring-fenced trust/escrow account**, segregated from NEDA LABS'
  operational funds.
- **No rehypothecation. No yield/staking** on customer funds during the sandbox (no separate written approval sought).
- **Bank functions:** reserve custody, FX conversion, TZS settlement, and core AML/CFT.

> **Status to confirm on the day:** the executed **custody confirmation letter from Selcom Bank**.
> Where formal execution is pending, present the signed arrangement/heads-of-terms and the operational
> account details, and flag completion timing to BoT proactively.

## 2. Composition

The reserve backs nTZS **1:1** and is composed of TZS-denominated assets:

| Asset class | Sandbox phase (current) | Target |
|---|---|---|
| Cash / call deposits at the custodian | 100% | Working balance for settlement liquidity |
| Short-term government securities (Treasury Bills) | 0% (to be introduced) | Yield-bearing portion of the reserve, per approved parameters |
| Fixed-term deposits | 0% | Optional, as volumes grow |

During initial testing the reserve is held **entirely as cash / call deposits** to maximise redemption
liquidity. Introduction of T-bills follows the approved composition and is reflected in the daily
attestation (line item (c), "TZS in government securities").

## 3. The 1:1 invariant

- **nTZS outstanding must never exceed the TZS held in reserve.** Minting occurs **only after** the
  equivalent cash is confirmed in the trust account.
- Redemptions burn nTZS and release TZS from the reserve, preserving the ratio.

## 4. Reconciliation & attestation (demonstrable live)

- **On-chain supply** is read directly from the nTZS contract (`totalSupply()`), independently verifiable on BaseScan.
- **Reserve balance** is taken from the custodial/PSP settled position.
- A **daily reconciliation runs at 10:00 EAT**, is **archived immutably** (SHA-256 hashed), and reports:
  (a) total nTZS in circulation, (b) TZS in custodial reserve, (c) TZS in government securities,
  (d) deviation from 1:1 (target 0.00%).
- Continuous reconciliation raises an **alert on any drift** beyond tolerance; a reserve shortfall
  triggers **BoT notification and suspension of new minting**.
- The **Oversight portal** presents all of the above to BoT in real time (Reserve Proof + Daily Attestation).

## 5. Records

Reserve movements, bank statements, and daily attestations are retained for the sandbox period and
available for BoT inspection at any time.
