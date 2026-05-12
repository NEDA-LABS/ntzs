# 07 — Response to Third-Party Contract Audit Findings

**Document owner**: NEDA Labs Limited  
**Last updated**: May 2026  
**Classification**: Regulatory — Bank of Tanzania Sandbox Submission

---

## 1. Summary

The originally deployed contract (`NTZS.sol`, V1) was reviewed by an independent third-party auditor. Six findings were identified. All six have been resolved in the upgraded contract **NTZSV2**, which is the version currently deployed in production on Base Mainnet at `0xF476BA983DE2F1AD532380630e2CF1D1b8b10688`.

The upgrade was executed through the Gnosis Safe multi-sig using the UUPS proxy pattern — preserving all token balances and role assignments while replacing the implementation contract.

---

## 2. Findings Matrix

| # | Severity | Title | Status |
|---|---|---|---|
| 6 | High | Contract not upgradeable | ✅ Resolved |
| 5 | Medium | State change events emitted even when state unchanged | ✅ Resolved |
| 4 | Low | Redundant ERC-20 inheritance | ✅ Resolved |
| 3 | Medium | Wipe blocked while contract is paused | ✅ Resolved |
| 2 | Low | String-based errors instead of custom errors | ✅ Resolved |
| 1 | Info | Redundant conditional checks in `_update` | ✅ Resolved |

---

## 3. Detailed Resolutions

### Finding #6 — Contract Not Upgradeable (High)

**Original issue**: V1 contract was not upgradeable. Bugs or improvements required a full token migration, which is disruptive for users and integrations.

**Resolution**: NTZSV2 implements the **UUPS (EIP-1822) upgradeable proxy pattern** using OpenZeppelin's `UUPSUpgradeable`.

- Proxy address is the stable token address; implementation can be replaced.
- `_authorizeUpgrade` is restricted to `DEFAULT_ADMIN_ROLE` — held exclusively by the Gnosis Safe multi-sig.
- The implementation contract calls `_disableInitializers()` in its constructor to prevent direct initialization.
- All integrations use the proxy address as the canonical token address.

**Artifacts**:
- Contract: `packages/contracts/contracts/NTZSV2.sol`
- Upgrade test: `packages/contracts/contracts/NTZSV3.sol`
- Deploy script: `packages/contracts/scripts/deploy-base-sepolia-v2.ts`

---

### Finding #5 — Events Emitted Without State Change (Medium)

**Original issue**: `freeze()`, `unfreeze()`, `blacklist()`, and `unblacklist()` emitted events even when the account was already in the target state (e.g., calling `freeze` on an already-frozen account). This made the event stream unreliable as a canonical audit trail.

**Resolution**: All four functions now **revert** if the account is already in the target state:
- `freeze(account)` reverts if `frozen[account] == true`
- `unfreeze(account)` reverts if `frozen[account] == false`
- `blacklist(account)` reverts if `blacklisted[account] == true`
- `unblacklist(account)` reverts if `blacklisted[account] == false`

**Effect**: The event stream is now canonical for state transitions — each `Frozen`, `Unfrozen`, `Blacklisted`, `Unblacklisted` event represents an actual state change.

---

### Finding #4 — Redundant ERC-20 Inheritance (Low)

**Original issue**: V1 explicitly inherited both `ERC20` and `ERC20Pausable`, which in turn also inherits `ERC20`. This created redundant inheritance.

**Resolution**: NTZSV2 uses `ERC20PausableUpgradeable` (which includes ERC-20 functionality) as the sole ERC-20 base. The redundant explicit `ERC20` inheritance is removed.

---

### Finding #3 — Wipe Blocked While Paused (Medium)

**Original issue**: `wipeBlacklisted()` used the standard `_burn` path which is gated by the pause check. During an emergency pause, administrative remediation (seizing blacklisted balances per regulatory instruction) was blocked.

**Resolution**: NTZSV2 explicitly permits `wipeBlacklisted` to execute **even while the contract is paused** by routing the wipe through a path that bypasses the pause check.

- `burn(from, amount)` remains **blocked** while paused.
- `wipeBlacklisted(account)` is **permitted** while paused.

**Justification**: Regulatory enforcement cannot be contingent on the operational state of the contract. A pause is an emergency measure for ordinary transfers; it must not prevent legally required asset seizures.

---

### Finding #2 — String-Based Errors (Low)

**Original issue**: V1 used string `require` messages (e.g., `require(condition, "Error message")`), which consume more gas and are less amenable to programmatic error handling.

**Resolution**: NTZSV2 replaces all string-based `require` statements with **custom Solidity errors** (introduced in Solidity 0.8.4), e.g.:

```solidity
error AccountFrozen(address account);
error AccountBlacklisted(address account);
error NotBlacklisted(address account);
```

Custom errors use less gas and are easier to catch and decode in client applications.

---

### Finding #1 — Redundant Conditional Checks in `_update` (Info)

**Original issue**: The overridden `_update` function had redundant branching — some conditions were checked twice or in an overly nested structure.

**Resolution**: Consolidated `_update` into a clean single `from != address(0)` block for send-path checks, and separated mint-path and burn/transfer-path logic clearly. This reduces gas consumption and makes the restriction logic easier to audit.

---

## 4. Implementation Artifacts

| Artifact | Location |
|---|---|
| Production contract | `packages/contracts/contracts/NTZSV2.sol` |
| Upgrade continuity test contract | `packages/contracts/contracts/NTZSV3.sol` |
| Proxy deploy script | `packages/contracts/scripts/deploy-base-sepolia-v2.ts` |
| Test suite | `packages/contracts/test/ntzs.test.ts` |
| Deployed proxy (Base Mainnet) | `0xF476BA983DE2F1AD532380630e2CF1D1b8b10688` |
| Gnosis Safe (admin) | `0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503` |

---

## 5. Post-Audit Verification

After deployment:
- All six findings verified resolved via test suite (`pnpm test` in `packages/contracts`).
- NTZSV2 deployed behind UUPS proxy on Base Sepolia (testnet) and validated.
- Upgrade path tested: NTZSV2 → NTZSV3 via Safe, confirming all balances and roles preserved.
- Production deployment to Base Mainnet completed via Gnosis Safe multi-sig.
- Basescan verification completed — contract source published.
