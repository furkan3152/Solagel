// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "./vendor/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title ElymumNFT
/// @notice The Elymum NFT: an allowlist phase (OpenZeppelin Merkle tree, double-hashed `abi.encode(address)` leaves)
///         and a public phase, priced in HYPE wei (kept near $1 by the owner or a bounded price keeper).
/// @dev    Token ids start at 1. No `immutable` variables, so the runtime bytecode is identical for every deployment.
contract ElymumNFT is ERC721, ERC2981, Ownable2Step, ReentrancyGuard {
    enum Phase {
        Closed,
        Allowlist,
        Public
    }

    struct MintStateView {
        Phase phase;
        uint256 price;
        uint256 minPrice;
        uint256 maxPrice;
        address keeper;
        bytes32 root;
        uint32 maxSupply;
        uint32 totalSupply;
        uint16 wlLimit;
        uint16 publicLimit;
        address treasury;
        bool frozen;
    }

    struct MintCount {
        uint16 wl;
        uint16 pub;
    }

    /// @notice Royalty upper bound (10 %).
    uint96 public constant MAX_ROYALTY_BPS = 1_000;

    // slot: keeper (20) + phase (1) + frozen (1) + wlLimit (2) + publicLimit (2) + maxSupply (4) = 30
    address private _keeper;
    Phase private _phase;
    bool private _frozen;
    uint16 private _wlLimit;
    uint16 private _publicLimit;
    uint32 private _maxSupply;
    // slot: treasury (20) + totalSupply (4)
    address private _treasury;
    uint32 private _totalSupply;

    uint256 private _price;
    uint256 private _minPrice;
    uint256 private _maxPrice;
    bytes32 private _root;
    string private _baseTokenURI;
    string private _contractURI;
    mapping(address => MintCount) private _minted;

    event PhaseSet(Phase phase);
    event MerkleRootSet(bytes32 root);
    event PriceSet(uint256 price, address indexed by);
    event PriceBoundsSet(uint256 minPrice, uint256 maxPrice);
    event PriceKeeperSet(address indexed keeper);
    event LimitsSet(uint16 wlLimit, uint16 publicLimit);
    event MaxSupplySet(uint32 maxSupply);
    event BaseURISet(string uri);
    event MetadataFrozen();
    event TreasurySet(address indexed treasury);
    event RoyaltySet(address indexed receiver, uint96 bps);
    event Withdrawn(address indexed treasury, uint256 amount);
    /// @notice `phase` is the phase the tokens were minted under; `Phase.Closed` marks an owner mint.
    event Minted(address indexed to, uint256 firstId, uint256 qty, Phase phase, uint256 paid);
    /// @notice ERC-4906.
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    /// @notice ERC-7572.
    event ContractURIUpdated();

    error ZeroAddress();
    error ZeroQuantity();
    error MintClosed();
    error NotAllowlisted();
    error WlLimitExceeded();
    error PublicLimitExceeded();
    error SoldOut();
    error InsufficientPayment();
    error RefundFailed();
    error WithdrawFailed();
    error NotPriceSetter();
    error PriceOutOfBounds();
    error InvalidPriceBounds();
    error MaxSupplyIncrease();
    error MaxSupplyBelowTotal();
    error MetadataIsFrozen();
    error RoyaltyTooHigh();
    error RenounceDisabled();

    /// @param owner_     Contract owner (Ownable2Step).
    /// @param maxSupply_ Supply cap; can only go down later.
    /// @param mintPrice  Price per token in wei.
    /// @param wlLimit    Per-wallet allowlist limit.
    /// @param publicLimit Per-wallet public limit.
    /// @param baseURI    `tokenURI(id) = baseURI + id`.
    /// @param treasury   Receives `withdraw`.
    constructor(
        address owner_,
        uint32 maxSupply_,
        uint256 mintPrice,
        uint16 wlLimit,
        uint16 publicLimit,
        string memory baseURI,
        address treasury
    ) ERC721("Elymum", "ELYMUM") Ownable(owner_) {
        if (treasury == address(0)) revert ZeroAddress();
        _maxSupply = maxSupply_;
        _price = mintPrice;
        _wlLimit = wlLimit;
        _publicLimit = publicLimit;
        _baseTokenURI = baseURI;
        _treasury = treasury;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Mint
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Allowlist mint (phase Allowlist or Public). `msg.value >= price * qty`; the excess is refunded.
    function mintAllowlist(uint256 qty, bytes32[] calldata proof) external payable nonReentrant {
        Phase phase = _phase;
        if (phase == Phase.Closed) revert MintClosed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        if (!MerkleProof.verifyCalldata(proof, _root, leaf)) revert NotAllowlisted();
        if (qty == 0) revert ZeroQuantity();
        MintCount storage m = _minted[msg.sender];
        if (uint256(m.wl) + qty > _wlLimit) revert WlLimitExceeded();
        m.wl += uint16(qty); // qty <= wlLimit <= type(uint16).max
        _paidMint(qty, Phase.Allowlist);
    }

    /// @notice Public mint (phase Public). `msg.value >= price * qty`; the excess is refunded.
    function mintPublic(uint256 qty) external payable nonReentrant {
        if (_phase != Phase.Public) revert MintClosed();
        if (qty == 0) revert ZeroQuantity();
        MintCount storage m = _minted[msg.sender];
        if (uint256(m.pub) + qty > _publicLimit) revert PublicLimitExceeded();
        m.pub += uint16(qty);
        _paidMint(qty, Phase.Public);
    }

    /// @notice Owner mint (any phase, free, no per-wallet limit; the supply cap applies).
    function ownerMint(address to, uint256 qty) external onlyOwner nonReentrant {
        if (qty == 0) revert ZeroQuantity();
        uint256 first = _mintMany(to, qty);
        emit Minted(to, first, qty, Phase.Closed, 0);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Owner / keeper
    // ------------------------------------------------------------------------------------------------------------

    function setPhase(Phase p) external onlyOwner {
        _phase = p;
        emit PhaseSet(p);
    }

    function setMerkleRoot(bytes32 root) external onlyOwner {
        _root = root;
        emit MerkleRootSet(root);
    }

    /// @notice The owner sets any price; the keeper only within `[minPrice, maxPrice]` (bounds must be set).
    function setPrice(uint256 wei_) external {
        if (msg.sender != owner()) {
            if (msg.sender != _keeper || _keeper == address(0)) revert NotPriceSetter();
            if (_maxPrice == 0 || wei_ < _minPrice || wei_ > _maxPrice) revert PriceOutOfBounds();
        }
        _price = wei_;
        emit PriceSet(wei_, msg.sender);
    }

    /// @notice Bounds for the price keeper: `0 < minWei <= maxWei`.
    function setPriceBounds(uint256 minWei, uint256 maxWei) external onlyOwner {
        if (minWei == 0 || minWei > maxWei) revert InvalidPriceBounds();
        _minPrice = minWei;
        _maxPrice = maxWei;
        emit PriceBoundsSet(minWei, maxWei);
    }

    /// @notice `address(0)` removes the keeper.
    function setPriceKeeper(address keeper) external onlyOwner {
        _keeper = keeper;
        emit PriceKeeperSet(keeper);
    }

    function setLimits(uint16 wl, uint16 pub) external onlyOwner {
        _wlLimit = wl;
        _publicLimit = pub;
        emit LimitsSet(wl, pub);
    }

    /// @notice Lowers the supply cap (never up, never below the minted supply).
    function setMaxSupply(uint32 max) external onlyOwner {
        if (max > _maxSupply) revert MaxSupplyIncrease();
        if (max < _totalSupply) revert MaxSupplyBelowTotal();
        _maxSupply = max;
        emit MaxSupplySet(max);
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        if (_frozen) revert MetadataIsFrozen();
        _baseTokenURI = uri;
        emit BaseURISet(uri);
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    function setContractURI(string calldata uri) external onlyOwner {
        _contractURI = uri;
        emit ContractURIUpdated();
    }

    /// @notice Freezes the base URI forever.
    function freezeMetadata() external onlyOwner {
        if (_frozen) revert MetadataIsFrozen();
        _frozen = true;
        emit MetadataFrozen();
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        _treasury = t;
        emit TreasurySet(t);
    }

    /// @notice Default ERC-2981 royalty (<= 10 %).
    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        _setDefaultRoyalty(receiver, bps); // reverts on a zero receiver
        emit RoyaltySet(receiver, bps);
    }

    /// @notice Sends the whole HYPE balance to the treasury.
    function withdraw() external onlyOwner nonReentrant {
        address to = _treasury;
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------------------------------------------

    function mintState() external view returns (MintStateView memory v) {
        v.phase = _phase;
        v.price = _price;
        v.minPrice = _minPrice;
        v.maxPrice = _maxPrice;
        v.keeper = _keeper;
        v.root = _root;
        v.maxSupply = _maxSupply;
        v.totalSupply = _totalSupply;
        v.wlLimit = _wlLimit;
        v.publicLimit = _publicLimit;
        v.treasury = _treasury;
        v.frozen = _frozen;
    }

    function mintedBy(address account) external view returns (uint16 wl, uint16 pub) {
        MintCount storage m = _minted[account];
        return (m.wl, m.pub);
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    /// @notice Disabled: an ownerless NFT could never be withdrawn from, re-priced or have its metadata moved.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------------------

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function _paidMint(uint256 qty, Phase phase) private {
        uint256 cost = _price * qty;
        if (msg.value < cost) revert InsufficientPayment();
        uint256 first = _mintMany(msg.sender, qty);
        emit Minted(msg.sender, first, qty, phase, cost);
        uint256 excess = msg.value - cost;
        if (excess != 0) {
            (bool ok,) = msg.sender.call{value: excess}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @dev Plain `_mint` (no receiver callback), ids `totalSupply + 1 ..`.
    function _mintMany(address to, uint256 qty) private returns (uint256 first) {
        uint256 supply = _totalSupply;
        if (supply + qty > _maxSupply) revert SoldOut();
        first = supply + 1;
        _totalSupply = uint32(supply + qty);
        for (uint256 i; i < qty; ++i) {
            _mint(to, first + i);
        }
    }
}
