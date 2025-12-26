# nTZS

nTZS is an ERC-20 stablecoin-style token issued against approved fiat deposits. This repository contains:

- `apps/web`: Next.js web app (includes `/backstage` super-admin portal)
- `apps/worker`: background worker that mints nTZS on-chain for approved deposits
- `packages/contracts`: Hardhat workspace for the nTZS ERC-20 contract
- `packages/db`: Drizzle schema + DB client

## Networks

- Base Sepolia (chainId: `84532`)

## Deployed contracts

- nTZS (Base Sepolia): `0x6A9525A5C82F92E10741Fcdcb16DbE9111630077`
- Safe admin (Base Sepolia): `0x943Ec4ECA8195F54Fb5369B168534F9462Ce4faa`

## Quick start

1. Install dependencies

```bash
npm install
```

2. Configure env

Create `.env.local` (never commit secrets). Required variables:

- `DATABASE_URL`
- `BASE_SEPOLIA_RPC_URL`
- `NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA`
- `NTZS_SAFE_ADMIN`
- `MINTER_PRIVATE_KEY`

Optional:

- `WORKER_POLL_MS` (default: 5000)

3. Run the web app

```bash
npm run dev:web
```

4. Run the worker

```bash
npm run dev:worker
```

## Mint worker behavior

The worker continuously:

- Polls for `deposit_requests` with `status = mint_pending` and `chain = base`
- Claims the next request using row locking, sets it to `mint_processing`
- Submits an on-chain mint transaction
- Writes/updates `mint_transactions` (`tx_hash`, status, error)
- Marks the deposit request `minted` (or `mint_failed` on error)

## Backstage admin portal

Open:

- `http://localhost:3000/backstage`

The Backstage portal:

- Is gated to `super_admin`
- Lets you manage user roles
- Includes an nTZS admin panel that generates Safe-compatible transaction payloads for:
  - pause / unpause
  - freeze / unfreeze
  - blacklist / unblacklist
  - wipeBlacklisted

## Token metadata assets

The web app hosts a simple token list and logo:

- Token list: `/tokenlist.json`
- Logo: `/ntzs-logo.png`

These are intended for hosting on a public domain and then using the public URLs when submitting token metadata to explorers.

## Contracts

The nTZS contract includes:

- Pausable
- Role-based mint/burn
- Freeze and blacklist controls
- Wipe (burn) for blacklisted balances

Development scripts live in `packages/contracts`.
