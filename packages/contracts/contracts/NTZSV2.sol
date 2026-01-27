// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract NTZSV2 is Initializable, ERC20PausableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FREEZER_ROLE = keccak256("FREEZER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");
    bytes32 public constant WIPER_ROLE = keccak256("WIPER_ROLE");

    mapping(address => bool) private _frozen;
    mapping(address => bool) private _blacklisted;
    bool private _wiping;

    error ZeroSafeAdmin();
    error AlreadyFrozen(address account);
    error NotFrozen(address account);
    error AlreadyBlacklisted(address account);
    error NotBlacklisted(address account);
    error SenderFrozen(address account);
    error SenderBlacklisted(address account);
    error RecipientBlacklisted(address account);
    error TokenPaused();

    event Frozen(address indexed account);
    event Unfrozen(address indexed account);
    event Blacklisted(address indexed account);
    event Unblacklisted(address indexed account);
    event Wiped(address indexed account, uint256 amount);

    constructor() {
        _disableInitializers();
    }

    function initialize(address safeAdmin) public initializer {
        if (safeAdmin == address(0)) revert ZeroSafeAdmin();

        __ERC20_init("nTZS", "nTZS");
        __ERC20Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, safeAdmin);

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
        if (_frozen[account]) revert AlreadyFrozen(account);
        _frozen[account] = true;
        emit Frozen(account);
    }

    function unfreeze(address account) external onlyRole(FREEZER_ROLE) {
        if (!_frozen[account]) revert NotFrozen(account);
        _frozen[account] = false;
        emit Unfrozen(account);
    }

    function blacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        if (_blacklisted[account]) revert AlreadyBlacklisted(account);
        _blacklisted[account] = true;
        emit Blacklisted(account);
    }

    function unblacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        if (!_blacklisted[account]) revert NotBlacklisted(account);
        _blacklisted[account] = false;
        emit Unblacklisted(account);
    }

    function wipeBlacklisted(address account) external onlyRole(WIPER_ROLE) {
        if (!_blacklisted[account]) revert NotBlacklisted(account);

        uint256 amount = balanceOf(account);

        _wiping = true;
        _burn(account, amount);
        _wiping = false;
        emit Wiped(account, amount);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20PausableUpgradeable)
    {
        bool isWipeBurn =
            (to == address(0)) &&
            (from != address(0)) &&
            _wiping &&
            _blacklisted[from] &&
            hasRole(WIPER_ROLE, _msgSender());

        if (paused() && !isWipeBurn) {
            revert TokenPaused();
        }

        if (from != address(0)) {
            if (_frozen[from]) {
                revert SenderFrozen(from);
            }

            if (_blacklisted[from] && !isWipeBurn) {
                revert SenderBlacklisted(from);
            }
        }

        if (to != address(0) && _blacklisted[to]) {
            revert RecipientBlacklisted(to);
        }

        ERC20Upgradeable._update(from, to, value);
    }

    uint256[47] private __gap;
}
