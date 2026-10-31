// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestToken
/// @notice Mintable ERC-20 for localnet and Elysium Testnet only ("Elymum Test Token", tELYMUM, 18 decimals).
///         Anyone can take 1,000,000 tokens from `faucet` once per hour; the owner can mint any amount.
contract TestToken is ERC20, Ownable {
    /// @notice Amount handed out by `faucet`.
    uint256 public constant FAUCET_AMOUNT = 1_000_000 ether;
    /// @notice Per-address delay between two faucet calls.
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Last faucet time per address (0 = never).
    mapping(address => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 availableAt);

    constructor(address owner_) ERC20("Elymum Test Token", "tELYMUM") Ownable(owner_) {}

    /// @notice Mints `FAUCET_AMOUNT` to the caller, at most once per `FAUCET_COOLDOWN`.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Owner mint.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
