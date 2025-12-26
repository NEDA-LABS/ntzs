// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract NTZS is ERC20, ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FREEZER_ROLE = keccak256("FREEZER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");
    bytes32 public constant WIPER_ROLE = keccak256("WIPER_ROLE");

    mapping(address => bool) private _frozen;
    mapping(address => bool) private _blacklisted;

    event Frozen(address indexed account);
    event Unfrozen(address indexed account);
    event Blacklisted(address indexed account);
    event Unblacklisted(address indexed account);
    event Wiped(address indexed account, uint256 amount);

    constructor(address safeAdmin) ERC20("nTZS", "nTZS") {
        require(safeAdmin != address(0), "NTZS: safe admin is zero address");

        _grantRole(DEFAULT_ADMIN_ROLE, safeAdmin);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        _grantRole(PAUSER_ROLE, safeAdmin);
        _grantRole(FREEZER_ROLE, safeAdmin);
        _grantRole(BLACKLISTER_ROLE, safeAdmin);
        _grantRole(WIPER_ROLE, safeAdmin);
        _grantRole(MINTER_ROLE, safeAdmin);
        _grantRole(BURNER_ROLE, safeAdmin);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }

    function isFrozen(address account) external view returns (bool) {
        return _frozen[account];
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    function freeze(address account) external onlyRole(FREEZER_ROLE) {
        _frozen[account] = true;
        emit Frozen(account);
    }

    function unfreeze(address account) external onlyRole(FREEZER_ROLE) {
        _frozen[account] = false;
        emit Unfrozen(account);
    }

    function blacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[account] = true;
        emit Blacklisted(account);
    }

    function unblacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[account] = false;
        emit Unblacklisted(account);
    }

    function wipeBlacklisted(address account) external onlyRole(WIPER_ROLE) {
        require(_blacklisted[account], "NTZS: account is not blacklisted");

        uint256 amount = balanceOf(account);
        _burn(account, amount);
        emit Wiped(account, amount);
    }

    function renounceDeployerAdmin() external {
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Pausable) {
        if (from != address(0)) {
            require(!_frozen[from], "NTZS: sender is frozen");
        }

        if (from != address(0)) {
            if (_blacklisted[from]) {
                bool isWipeBurn = (to == address(0)) && hasRole(WIPER_ROLE, _msgSender());
                require(isWipeBurn, "NTZS: sender is blacklisted");
            }
        }

        if (to != address(0)) {
            require(!_blacklisted[to], "NTZS: recipient is blacklisted");
        }

        super._update(from, to, value);
    }
}
