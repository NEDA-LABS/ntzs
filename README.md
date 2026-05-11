# nTZS — NEDApay Stablecoin

nTZS is a Tanzanian Shilling-pegged ERC-20 stablecoin issued on a strict 1:1 basis against TZS-denominated reserves. It powers **NEDApay**, an omni-channel digital wallet built for Tanzania's mobile money ecosystem.

> **Regulatory Status**: NEDA LABS Limited has received **in-principle approval** to participate in the [Bank of Tanzania Fintech Regulatory Sandbox](https://www.bot.go.tz) (Ref. LD. 170/515/02/1254, 23 April 2026). Sandbox testing must commence by **23 June 2026**.

---

## Architecture

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
│   User App       │   │   Backstage      │   │   Snippe (active)    │
│   (Next.js)      │   │   (Admin Panel)  │   │   (M-Pesa, TigoPesa) │
└────────┬─────────┘   └────────┬─────────┘   └──────────┬───────────┘
         │                      │                         │
         ▼                      ▼                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        PostgreSQL (Neon)                            │
│  Users · KYC · Wallets · Deposits · Burns · Transfers · Audit Logs │
└──────────────────────────┬──────────────────┬───────────────────────┘
                           │                  │
                           ▼                  ▼
               ┌────────────────┐   ┌──────────────────┐
               │   Cron Jobs    │   │   Mint Worker    │
               │ · Poll PSPs    │   │ · Mint nTZS      │
               │ · BoT reports  │   │ · Daily cap      │
               └────────────────┘   └────────┬─────────┘
                                             │
                                             ▼
              ┌──────────────────────────────────────────────┐
              │          Base Blockchain (nTZS Contract)     │
              │  ERC-20 · Pause · Freeze · Blacklist · Wipe  │
              └──────────────────────────────────────────────┘
```

## Repository Structure

| Path | Description |
|---|---|
| `apps/web` | Next.js app — user portal, backstage admin, all API routes |
| `apps/worker` | Background worker — burn processing, LP earnings |
| `apps/market-maker` | Automated market maker |
| `packages/contracts` | Hardhat — nTZS ERC-20 smart contract (UUPS upgradeable) |
| `packages/db` | Drizzle ORM schema + PostgreSQL client |
| `packages/sdk` | WaaS partner SDK |
| `packages/shared` | Shared types and utilities |

## Networks & Deployments

| Network | Chain ID | Contract (UUPS proxy) | Explorer |
|---|---|---|---|
| Base (mainnet) | `8453` | `0xF476BA983DE2F1AD532380630e2CF1D1b8b10688` | [Basescan](https://basescan.org/token/0xF476BA983DE2F1AD532380630e2CF1D1b8b10688) |
| Base Sepolia (testnet) | `84532` | `0x6A9525A5C82F92E10741Fcdcb16DbE9111630077` | [Basescan Sepolia](https://sepolia.basescan.org/address/0x6A9525A5C82F92E10741Fcdcb16DbE9111630077) |

Safe Admin (mainnet): `0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503`

## Quick Start

```bash
git clone https://github.com/mxsafiri/n-tzs.git
cd n-tzs
npm install
cp .env.example .env.local   # fill in your keys
npm run dev:web               # http://localhost:3000
npm run dev:worker            # mint worker (separate terminal)
```

**Key env vars:**
```env
DATABASE_URL=postgresql://...
BASE_RPC_URL=https://mainnet.base.org
NTZS_CONTRACT_ADDRESS_BASE=0xF476BA983DE2F1AD532380630e2CF1D1b8b10688
MINTER_PRIVATE_KEY=0x...
SNIPPE_API_KEY=...
SNIPPE_WEBHOOK_SECRET=whsec_...
DAILY_ISSUANCE_CAP_TZS=100000000
```

---

## BoT Sandbox Compliance Checklist

> Tracks implementation status against the Bank of Tanzania Testing Parameters (Ref. LD. 170/515/02/1254).
> **Deadline to commence testing: 23 June 2026.**

### 🔴 Blocking — Must be complete before first user onboarding

- [x] **Para #3 — Per-transaction cap (TZS 1,000,000)** · enforced in all deposit, burn & transfer APIs via `lib/sandbox/limits.ts`
- [x] **Para #4 — Daily per-user limit (TZS 2,000,000)** · rolling 24-hour sum across deposits + burns
- [x] **Para #5 — Monthly per-user cap (TZS 60,000,000)** · 30-day rolling window
- [ ] **Para #2 — Sandbox user cap (100 users max)** · applies to new bank/PSP integration corridor only; existing Snippe users are unaffected
- [ ] **Para #8 — Biometric KYC + OTP** · Smile Identity integration (national ID + selfie + OTP)
- [ ] **Para #8 — PEP screening + sanctions checks** · UN / BoT / OFAC before wallet activation
- [ ] **Para #14 — Multi-sig minting keys** · complete Gnosis Safe path (`mint_requires_safe` flow)
- [ ] **Para #7 / LR-2 — Automated daily reserve report** · cron → email BoT by 10:00 EAT
- [ ] **LR-1 — Operational liquidity buffer** · track 20% of 30-day avg daily redemptions
- [ ] **Para #12 — TZS-only UI** · audit all end-user screens; no "nTZS" terminology visible to users

### 🟡 Required during sandbox operation

- [ ] **AML-1–7 — AML/CFT programme** · EDD auto-trigger, STR log, FIU reporting within 24h
- [ ] **R-11 / Para #12 — Consumer complaint SLA** · schema + dashboard, ≥90% resolved in 5 days
- [ ] **Para #9 — Tax compliance reporting** · VAT/WHT computation + TRA submission module
- [ ] **Para #16 — Monthly BoT operational report** · nTZS issued/redeemed, volumes, AML alerts
- [ ] **R-2 — Quarterly BoT progress report** · structured report generator
- [ ] **TR-1–4 — FATF Travel Rule** · originator/beneficiary data for cross-border >TZS 2,500,000
- [ ] **ST-1–4 — Quarterly stress testing framework** · 5 mandatory scenarios (reserve depletion, sync failure, volume surge, cyber, custodian)
- [ ] **BC-1–3 — BCP/DR documentation** · RTO 4h, RPO 1h; BoT notification within 30 min

### 🔵 Pre-testing documents to submit to BoT (Para #7)

- [ ] **(a)** Executed Testing Environment Agreement (Regulation 5(3)(g))
- [ ] **(b)** Formal PSP partnership confirmation letter
- [ ] **(c)** nTZS issuance/redemption protocol + diagrammatic token flow + smart contract control docs
- [ ] **(d)** Risk Management Plan (including fake e-money creation risk)
- [ ] **PD-1** — Register with Personal Data Protection Commission (data controller + processor)
- [ ] **R-10** — Evidence of IP ownership / registration of smart contracts and APIs

### ✅ Already implemented

- [x] **Para #6 — Platform daily cap (TZS 100,000,000)** · `dailyIssuance` table + cron enforcement
- [x] **Dual approval before minting** · bank approval + platform approval workflow
- [x] **On-chain freeze / blacklist / wipe** · NTZSV2 contract roles
- [x] **Burn/redemption dual-approval workflow** · `burnRequests` with two-level sign-off
- [x] **Audit logs** · all material actions logged
- [x] **PSP integration** · Snippe (active) — M-Pesa, TigoPesa, card; ZenoPay legacy (historical records preserved)
- [x] **Backstage admin** · KYC, users, minting queue, burns, treasury, token-admin
- [x] **Reserves dashboard** · total nTZS in circulation vs. TZS in custody
- [x] **WaaS partner API + SDK** · `POST /api/v1/deposits`, `/withdrawals`, `/transfers`

---

## Core Token Contract

**NTZSV2** (UUPS upgradeable ERC-20 on Base — currently deployed):

| Role | Purpose |
|---|---|
| `MINTER_ROLE` | Mint new nTZS (requires prior fiat deposit confirmation) |
| `BURNER_ROLE` | Burn nTZS on redemption |
| `PAUSER_ROLE` | Emergency pause all transfers |
| `FREEZER_ROLE` | Freeze individual wallet (can receive, cannot send) |
| `BLACKLISTER_ROLE` | Permanently block address |
| `WIPER_ROLE` | Burn balance of blacklisted address |

All roles are held by the Gnosis Safe multi-sig (`0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503`) on mainnet.

> **NTZSV3** is written and ready — it adds a `version()` introspection function. It will be applied as a UUPS upgrade once the third-party audit is complete.

## Deposit & Mint Flow

```
User pays TZS via M-Pesa / TigoPesa
         ↓
Snippe webhook fires → deposit status: awaiting_fiat
         ↓
Bank admin confirms fiat received → status: bank_approved
         ↓
Platform compliance approves → status: mint_pending
         ↓
Mint worker calls nTZS.mint(walletAddress, amount) on Base
         ↓
status: minted ✅ — user's wallet receives nTZS (displayed as TZS)
```

## Redemption & Burn Flow

```
User requests redemption
         ↓
Burn request created → status: requested
         ↓
Compliance officer approves → requires_second_approval
         ↓
Second approver signs off → burn_submitted
         ↓
nTZS burned on-chain → TZS sent to user's mobile money wallet
         ↓
status: burned ✅
```

---

## Security

- The nTZS contract is live on Base mainnet. An independent third-party audit is required before the BoT sandbox commences (required by sandbox parameters).
- Minting/burning keys are held by the Gnosis Safe multi-sig on mainnet; the full `mint_requires_safe` signing flow is pending completion.
- All sensitive operations produce immutable audit log entries.
- Bug bounty program planned post-sandbox.

---

## License

MIT — see [LICENSE](LICENSE).

---

*NEDA LABS Company Limited · Dar es Salaam, Tanzania 🇹🇿*
