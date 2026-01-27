# Burn / Withdraw Workflow

This document describes the platform burn (withdrawal) workflow introduced to support controlled supply reductions tied to a specific user.

Scope:

- Smart contract: `packages/contracts/contracts/NTZSV2.sol`
- Admin UI: `apps/web/src/app/backstage/burns/page.tsx`
- User UI: `apps/web/src/app/app/user/page.tsx`, `apps/web/src/app/app/user/activity/page.tsx`
- DB: `packages/db/src/schema.ts` (`burn_requests`)

## Overview

A burn (withdrawal) is modeled as a DB-backed request that is executed on-chain by an authorized operator key.

High-level flow:

1. Super Admin creates a burn request tied to a user.
2. The request requires approval (and may require a second approval if it exceeds a threshold).
3. Once approved, the burn is executed on-chain via `NTZSV2.burn(from, amount)`.
4. The on-chain transaction hash and final status are recorded.
5. The user sees the burn in “Recent Transactions” and “Activity”.

## Roles and Authorization

- On-chain burn uses `NTZSV2.burn(address from, uint256 amount)`.
- Only accounts with `BURNER_ROLE` can execute the on-chain burn.

Operationally, the platform executes burns using a server-side signer configured via environment variables.

## Policy: Pause Behavior

- When the token is paused, normal transfers are blocked.
- `burn(from, amount)` is blocked while paused.
- `wipeBlacklisted(account)` remains allowed while paused for admin-only remediation.

## Database Model

Table: `burn_requests`

Key fields:

- `user_id`: ties the burn to a specific platform user.
- `wallet_id`: the user wallet that will be burned.
- `amount_tzs`: integer amount in TZS (burn amount is `amount_tzs * 10^18` on-chain).
- `reason`: mandatory operator-provided reason for auditability.
- `status`: lifecycle state.
- `requested_by_user_id`: Super Admin who created the request.
- `approved_by_user_id`, `approved_at`: first approval metadata.
- `second_approved_by_user_id`, `second_approved_at`: second approval metadata (when required).
- `tx_hash`: on-chain burn transaction hash (when submitted).
- `error`: error message if execution fails.

### Statuses

- `requested`: newly created request.
- `requires_second_approval`: request exceeds threshold and needs a second approval step.
- `approved`: ready to execute on-chain.
- `burn_submitted`: transaction submitted / awaiting confirmation.
- `burned`: confirmed burn.
- `rejected`: not used in the current UI flow but reserved for future use.
- `failed`: burn attempt failed (error recorded).

## Approval Threshold

The burn workflow currently uses:

- `SAFE_BURN_THRESHOLD_TZS = 9000`

If a burn request amount is >= threshold, it enters `requires_second_approval`.

Note: the current implementation permits the same Super Admin to perform both approval steps (this can be tightened later to require distinct approvers).

## On-chain Execution Details

Execution is triggered from the Backstage Burns page:

- `executeBurnAction`:
  - Validates configuration (RPC URL, contract address, operator key).
  - Verifies token is not paused.
  - Converts amount: `amountWei = amountTzs * 10^18`.
  - Calls `burn(walletAddress, amountWei)`.
  - Stores `txHash` and transitions status.

Canonical on-chain signal:

- Burn is represented by an ERC-20 `Transfer(from, 0x0000000000000000000000000000000000000000, value)` event.

## UI Surfaces

### Admin portal

- `/backstage/burns`
  - Create burn request
  - Approve / second approve
  - Execute burn
  - View request status and tx hash

### User portal

- `/app/user` (Dashboard)
  - Displays burn items in “Recent Transactions” as a negative amount.
- `/app/user/activity`
  - Displays a unified transaction history (deposits + burns).

## Suggested auditor checks

- Confirm only `BURNER_ROLE` can execute `burn`.
- Confirm `burn` is blocked while paused; confirm `wipeBlacklisted` is allowed while paused.
- Confirm each burn is tied to a `burn_requests` row with a reason and user association.
- Confirm on-chain burn tx hashes correspond to expected `Transfer(to=0x0)` logs.
- Confirm the threshold logic is applied consistently for large burns.
