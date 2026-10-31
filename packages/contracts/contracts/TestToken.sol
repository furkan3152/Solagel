// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {HolderCheck} from "./HolderCheck.sol";

/// @title TestToken
/// @notice Mintable ERC-20 for localnet and Elysium Testnet only ("Elymum Test Token", tELYMUM, 18 decimals).
///         Anyone can take `faucetAmount` (default 1,000,000) from `faucet` once per `faucetCooldown` (default 1 h);
///         holders of `holderNft` take `holderFaucetAmount` (default 2,000,000). The owner and the minters it
///         appoints (`setMinter`, e.g. the game server key that funds testnet bots) can mint any amount.
contract TestToken is ERC20, Ownable {
    /// @notice Default `faucetAmount`.
    uint256 public constant FAUCET_AMOUNT = 1_000_000 ether;
    /// @notice Default `holderFaucetAmount`.
    uint256 public constant HOLDER_FAUCET_AMOUNT = 2_000_000 ether;
    /// @notice Default `faucetCooldown`.
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Amount handed out by `faucet` to a wallet that does not hold `holderNft`.
    uint256 public faucetAmount = FAUCET_AMOUNT;
    /// @notice Amount handed out by `faucet` to a holder of `holderNft`.
    uint256 public holderFaucetAmount = HOLDER_FAUCET_AMOUNT;
    /// @notice Per-address delay between two faucet calls, in seconds.
    uint64 public faucetCooldown = uint64(FAUCET_COOLDOWN);
    /// @notice ERC-721 whose holders get `holderFaucetAmount` (address(0) = no holder bonus).
    address public holderNft;

    /// @notice Last faucet time per address (0 = never).
    mapping(address => uint256) public lastFaucetAt;
    /// @notice Addresses allowed to `mint` besides the owner.
    mapping(address => bool) public isMinter;

    event MinterSet(address indexed minter, bool allowed);
    event HolderNftSet(address indexed nft);
    event FaucetSet(uint256 amount, uint256 holderAmount, uint64 cooldown);
    event FaucetClaimed(address indexed to, uint256 amount, bool holder);

    error FaucetCooldown(uint256 availableAt);
    error InvalidFaucet();
    error NotAContract();

    constructor(address owner_) ERC20("Elymum Test Token", "tELYMUM") Ownable(owner_) {}

    // ------------------------------------------------------------------------------------------------------------
    // Faucet
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Mints the caller's faucet amount (`faucetInfo`), at most once per `faucetCooldown`.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + faucetCooldown) revert FaucetCooldown(last + faucetCooldown);
        lastFaucetAt[msg.sender] = block.timestamp;
        bool holder = HolderCheck.isHolder(holderNft, msg.sender);
        uint256 amount = holder ? holderFaucetAmount : faucetAmount;
        _mint(msg.sender, amount);
        emit FaucetClaimed(msg.sender, amount, holder);
    }

    /// @notice What `faucet` gives `who` and when `who` may claim next (0 = never claimed; claimable once
    ///         `block.timestamp >= nextClaimAt`).
    function faucetInfo(address who) external view returns (uint256 amount, uint256 nextClaimAt) {
        amount = HolderCheck.isHolder(holderNft, who) ? holderFaucetAmount : faucetAmount;
        uint256 last = lastFaucetAt[who];
        nextClaimAt = last == 0 ? 0 : last + faucetCooldown;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Faucet amounts and cooldown. `amount > 0` and `holderAmount >= amount`.
    function setFaucet(uint256 amount, uint256 holderAmount, uint64 cooldown) external onlyOwner {
        if (amount == 0 || holderAmount < amount) revert InvalidFaucet();
        faucetAmount = amount;
        holderFaucetAmount = holderAmount;
        faucetCooldown = cooldown;
        emit FaucetSet(amount, holderAmount, cooldown);
    }

    /// @notice ERC-721 whose holders get the holder faucet amount; address(0) turns the bonus off.
    /// @dev    A broken NFT never blocks the faucet: the balance check never reverts (see HolderCheck).
    function setHolderNft(address nft) external onlyOwner {
        if (nft != address(0) && nft.code.length == 0) revert NotAContract();
        holderNft = nft;
        emit HolderNftSet(nft);
    }

    /// @notice Grants or revokes the right to `mint`.
    function setMinter(address minter, bool allowed) external onlyOwner {
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    /// @notice Mint by the owner or a minter. Anyone else gets `OwnableUnauthorizedAccount`.
    function mint(address to, uint256 amount) external {
        if (msg.sender != owner() && !isMinter[msg.sender]) revert OwnableUnauthorizedAccount(msg.sender);
        _mint(to, amount);
    }
}
