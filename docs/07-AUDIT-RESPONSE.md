# Response to Third-Party Contract Findings

This document maps the reported findings to the applied resolution.

Scope: `packages/contracts`

## Summary

The originally deployed contract (`NTZS.sol`) is not upgradeable. To address the findings as recommended, a new upgradeable contract (`NTZSV2`) is introduced and intended to be deployed behind a UUPS proxy.

## Findings and Resolutions

### #6 Contract not upgradeable

- Resolution: Introduced `NTZSV2` as a UUPS-upgradeable contract.
- Upgrade authorization: `_authorizeUpgrade` is restricted to `DEFAULT_ADMIN_ROLE` (intended to be held by a multisig Safe).
- Operational note: deployments should use the proxy address as the token address for integrations.
- Operational note: the implementation contract disables initializers in its constructor (`_disableInitializers()`), and tooling may require explicitly allowing this constructor for proxy validation.

### #5 State change functions emit events even when no state changes

- Resolution: `freeze`, `unfreeze`, `blacklist`, `unblacklist` now revert if the target state is already set (or not set).
- Effect: event stream becomes canonical for state transitions.

### #4 Redundant inheritance of ERC20 alongside ERC20Pausable

- Resolution: `NTZSV2` inherits from `ERC20PausableUpgradeable` (which provides ERC-20 functionality) and removes redundant base inheritance.

### #3 Wipe cannot be executed while the token is paused

- Resolution: `NTZSV2` permits `wipeBlacklisted` to execute while paused by allowing the specific wipe burn path to bypass pause restrictions.
- Effect: administrative remediation remains possible during emergency pause without re-enabling normal transfers.
- Note: `burn(from, amount)` remains blocked while paused. Only the explicitly-scoped `wipeBlacklisted` remediation path bypasses pause.

### #2 Use custom errors instead of strings

- Resolution: Replaced string-based `require` statements with custom errors in `NTZSV2`.

### #1 Redundant conditional checks in `_update`

- Resolution: Consolidated checks into a single `from != address(0)` block and reduced redundant branching.

## Implementation Artifacts

- Contract: `packages/contracts/contracts/NTZSV2.sol`
- Upgrade test target: `packages/contracts/contracts/NTZSV3.sol`
- Proxy deploy script: `packages/contracts/scripts/deploy-base-sepolia-v2.ts`
- Tests: `packages/contracts/test/ntzs.test.ts`
