# nTZS Review Pack (Third-Party Review)

This `/docs` folder is intended for third-party code reviewers and smart contract auditors.

## Repository Map

- `apps/web`
  - Next.js app with:
    - User portal under `/app`
    - Admin portal under `/backstage`
    - API routes under `/api` (webhooks, cron endpoints)
- `apps/worker`
  - Background worker that:
    - Polls for `mint_pending` deposits
    - Mints nTZS on-chain
    - Updates DB and audit logs
    - Polls ZenoPay as a fallback if webhooks fail.
- `packages/contracts`
  - Hardhat project containing the `NTZS.sol` ERC-20 contract
- `packages/db`
  - Drizzle schema and DB client

## Key Documents

- [01 Architecture](./01-ARCHITECTURE.md)
- [02 Deposit to Mint Lifecycle](./02-DEPOSIT-TO-MINT-LIFECYCLE.md)
- [03 Database Model](./03-DATABASE-MODEL.md)
- [04 Smart Contract](./04-SMART-CONTRACT.md)
- [07 Audit Response](./07-AUDIT-RESPONSE.md)
- [08 Burn / Withdraw Workflow](./08-BURN-WITHDRAW-WORKFLOW.md)
- [05 Security Model and Threats](./05-SECURITY-MODEL.md)
- [06 Operations Runbook](./06-OPERATIONS-RUNBOOK.md)

## Primary Review Goals

- Verify that **fiat confirmation and approvals** gate minting correctly.
- Verify **minting idempotency** and handling of failures/retries.
- Verify contract access control and admin powers (pause, freeze, blacklist, wipe).
- Verify burn (withdraw) workflow is auditable and tied to a user record (DB-backed), and that on-chain burns match recorded requests.
- Verify that **on-chain supply** can be reconciled against DB records (and is auditable).

## Core Concepts

### Deposit statuses (high-level)

- `submitted`: user initiated deposit; awaiting PSP confirmation and/or admin workflow.
- `mint_pending`: deposit confirmed/approved and waiting to mint.
- `mint_processing`: a worker has claimed the mint job.
- `mint_requires_safe`: mint requires Safe multisig approval (high amount).
- `minted`: mint completed and recorded.
- `mint_failed`: mint attempt failed.

### On-chain vs DB totals

- On-chain is the source of truth.
- DB tracks mints linked to deposits via `deposit_requests` + `mint_transactions`.
- If an on-chain mint occurs outside the normal flow (e.g. manual/test mint), it must be recorded as a **reconciliation entry** so that “DB tracked total” matches “on-chain supply”.

## Environment Variables (selected)

- `DATABASE_URL`: Neon Postgres connection string.
- `BASE_SEPOLIA_RPC_URL`: RPC endpoint for Base Sepolia.
- `NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA`: token proxy contract address.
- `MINTER_PRIVATE_KEY`: private key used by the worker to mint (must have `MINTER_ROLE`).
- `ZENOPAY_API_KEY`: API key for ZenoPay (used for payment creation and polling).
- `NEXT_PUBLIC_APP_URL`: used to construct webhook callback URLs.

## What is currently deployed

The repo currently targets Base Sepolia testnet.

For addresses, chain IDs, and any production deployment details, refer to the top-level `README.md`.
