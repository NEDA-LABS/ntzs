# nTZS — System Architecture

**Prepared for:** Bank of Tanzania — Pre-Testing On-Site Inspection
**Sandbox Ref:** LD.170/515/02/1254 · **Prepared:** 8 July 2026 · **Onsite:** 9 July 2026
**Contact:** Victor Muhagachi, CTO — victor@nedapay.xyz

> Diagram: `figures/system-architecture.svg`

## 1. Overview

nTZS is a Tanzanian-Shilling-pegged stablecoin, backed **1:1** by TZS-denominated reserves
(cash + short-term government securities) held in a **ring-fenced trust account at Selcom Bank**.
Tokens are issued and redeemed on **Base Mainnet** (chain ID 8453). All customer-facing settlement
is in **TZS**; nTZS is not legal tender and is restricted to approved sandbox participants.

The core invariant enforced end-to-end: **nTZS in circulation must never exceed the TZS held in
reserve**, and nTZS is **minted only after** the equivalent cash is confirmed in the trust account
(the §7(d) "no fake electronic money" control).

## 2. Components

| Component | Role |
|---|---|
| **Customer** | Direct web app, or a partner integrating via the WaaS API. Every wallet is KYC-linked. |
| **Mobile-money PSP** | AzamPay (primary) and Snippe — pay-in and pay-out over M-Pesa / Tigo Pesa / Airtel Money. BoT-licensed PSPs. |
| **NEDApay application** | Next.js on Vercel. Auth (Neon), role-based access control, maker-checker dual approval, sandbox limit enforcement, HMAC-verified PSP webhooks, and the mint/burn orchestration pipeline. |
| **Selcom Bank — trust account** | Single, controlled, ring-fenced TZS reserve account. Custody, FX, TZS settlement, and core AML/CFT. |
| **nTZS contract (NTZSV2)** | `0xF476BA983DE2F1AD532380630e2CF1D1b8b10688` — UUPS-upgradeable ERC-20 on Base. Roles: MINTER, BURNER, BLACKLISTER. Authority held by a Safe multisig (`0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503`). |
| **Oversight portal** | A read-only regulator surface: Reserve Proof, the daily attestation, the full audit trail with cash-before-mint provenance, Identity & AML, and issuance controls. |

## 3. Issuance flow (mint — strictly after cash)

1. Customer initiates a TZS pay-in via a licensed PSP (AzamPay/Snippe).
2. Funds settle into the **Selcom trust account**; the PSP confirms receipt.
3. NEDApay receives an **HMAC-signed `fiat_confirmed` webhook** (fails closed on bad signature/stale timestamp).
4. The deposit passes the pipeline: `submitted → fiat_confirmed → bank_approved → platform_approved` (**dual control**).
5. **Only then** the MINTER role (Safe multisig) mints nTZS **1:1** to the customer's wallet on Base.
6. Every mint is on-chain, timestamped, and recorded with its originating deposit (see the audit trail's TZS provenance).

## 4. Redemption flow (burn)

1. Holder requests redemption (TZS payout).
2. Request passes **dual approval** (maker-checker).
3. The BURNER role burns the nTZS on-chain.
4. The equivalent TZS is released from the trust account and paid to the beneficiary in TZS via the PSP.
5. If a payout fails asynchronously, the burned amount is **re-minted** (idempotent, replay-safe) so the holder is made whole.

## 5. Reserve integrity & reconciliation

- The **reserve balance ↔ on-chain supply** is reconciled continuously; drift beyond tolerance triggers an alert.
- A **daily reconciliation attestation runs at 10:00 EAT** and is archived immutably (SHA-256 hashed), reporting:
  (a) total nTZS in circulation, (b) TZS in custodial reserve, (c) TZS in government securities, (d) deviation from 1:1.
- The Oversight portal presents all of the above live and links to the contract on BaseScan for independent verification.

## 6. Controls summary

- **Mint gated on confirmed cash** — no minting before reserve settlement.
- **Sandbox limits enforced in code** — 1,000,000 TZS/txn; 2,000,000 TZS/user/day; 60,000,000 TZS/user/month; 100,000,000 TZS/day platform ceiling (auto-suspend on breach).
- **Dual control** on mints, burns/redemptions, FX changes, and treasury movements.
- **No anonymous wallets** — every wallet is bound to a verified identity; new-wallet issuance is paused pending bank-grade KYC.
- **Pause / kill-switch** — minting and swaps can be halted on direction; redemptions remain available.
