// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {HolderCheck} from "./HolderCheck.sol";

/// @title ElymumArena
/// @notice Ticket escrow for the Elymum arenas on Elysium. Players pay an entry fee into an arena with `join`.
///         Version 2 ("fee on entry"): the platform fee is `feeBps` of the ENTRY FEE of every ticket that is
///         played, whatever the result; there is no fee on profit. At join the fee part is reserved (`Arena.fees`)
///         and only the rest, the ticket's value `entryFee - fee`, goes into the arena vault and is played. At the
///         bell the game server pays every ticket its in-game value with `settle` (the reserved fee goes to the fee
///         wallet, nothing is taken from the payout) and burns floor loot with `sweepLoot`. A ticket that was never
///         played is cancelled by the server with `cancel` (the full entry fee comes back, no fee), and a ticket
///         the server never settles can be refunded in full by its player after 24 h.
///         Holders of the Elymum emblem (`setHolderPerks`) pay a lower fee and may enter holders-only arenas.
/// @dev    Accounting is internal: `Arena.vault` is what settlements, cancels, refunds and loot burns may spend,
///         `Arena.fees` is the fee reserved for open tickets and `Arena.owed` is held for players whose transfer
///         failed (two-phase settle). The contract's token balance is always `sum(vault) + sum(fees) + sum(owed)`
///         plus anything sent to it directly (which stays locked: `rescue` never touches the game token). No
///         `immutable` variables, so the runtime bytecode is identical for every deployment.
contract ElymumArena is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Basis-point denominator (100 %).
    uint16 public constant BPS = 10_000;
    /// @notice Upper bound of `feeBps` (10 %).
    uint16 public constant MAX_FEE_BPS = 1_000;
    /// @notice Fee on the entry fee at deploy (5 %).
    uint16 public constant DEFAULT_FEE_BPS = 500;
    /// @notice Contract version: 2 = fee on entry (version 1, which has no `version()` view, took the fee on profit).
    uint16 public constant VERSION = 2;
    /// @notice Bounds of `Arena.maxSessions`.
    uint16 public constant MIN_ARENA_SESSIONS = 2;
    uint16 public constant MAX_ARENA_SESSIONS = 2_000;
    /// @notice A ticket that was never settled can be refunded by its player after this delay.
    uint64 public constant REFUND_DELAY = 24 hours;
    /// @notice Floor loot is burned by sending it here.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @notice `SettleSkipped.reason`: the arena does not exist.
    uint8 public constant SKIP_UNKNOWN_ARENA = 1;
    /// @notice `SettleSkipped.reason`: no open session with this id (never opened, already settled or refunded).
    uint8 public constant SKIP_SESSION_MISMATCH = 2;
    /// @notice `SettleSkipped.reason`: the session is already settled and waits for the player to collect.
    uint8 public constant SKIP_FINALIZED = 3;
    /// @notice `SettleSkipped.reason`: the payout is larger than the arena vault.
    uint8 public constant SKIP_INSUFFICIENT_VAULT = 4;

    // ------------------------------------------------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------------------------------------------------

    /// @dev 4 slots. Amounts are uint128 (checked arithmetic reverts long before a real token gets there).
    struct Arena {
        uint128 entryFee; // slot 0
        uint128 vault; //    slot 0: spendable by settle / refund / sweepLoot / sweepArena
        uint128 owed; //     slot 1: reserved for finalized sessions (collected with `refund`)
        uint64 lastSweepId; //slot 1
        uint16 maxSessions; //slot 1
        uint16 openSessions; //slot 1: joined and not yet settled or refunded (finalized ones do not count)
        bool enabled; //     slot 1
        bool exists; //      slot 1
        bool holdersOnly; // slot 1: `join` needs the holder NFT
        uint128 totalDeposited; // slot 2
        uint128 totalPaidOut; //   slot 2: settled payouts + cancels and refunds of unsettled tickets
        uint128 totalBurned; //    slot 3
        uint128 fees; //           slot 3: fees reserved for open tickets (paid at settle, returned by cancel / refund)
    }

    /// @dev 2 slots. `id == 0` means no session.
    struct Session {
        uint64 id; //        slot 0
        uint40 openedAt; //  slot 0
        uint16 feeBps; //    slot 0: fixed at join
        bool finalized; //   slot 0: settled, the player's share is `owed`
        uint128 entryFee; // slot 0
        uint128 owed; //     slot 1
    }

    /// @notice One ticket of a `cancel` batch.
    struct SessionRef {
        uint16 arenaId;
        address player;
        uint64 sessionId;
    }

    /// @notice One settlement of a `settle` batch.
    struct Settlement {
        uint16 arenaId;
        address player;
        uint64 sessionId;
        uint128 payout;
    }

    struct ConfigView {
        address admin;
        address pendingAdmin;
        address serverAuthority;
        address feeWallet;
        address token;
        uint8 decimals;
        uint16 feeBps;
        bool paused;
        uint64 totalSessions;
        uint64 totalGames;
        uint128 totalStaked;
        uint128 totalPaidOut;
        uint128 totalFees;
        uint128 totalBurned;
        address holderNft;
        uint16 holderFeeBps;
    }

    struct ArenaView {
        uint16 id;
        uint128 entryFee;
        uint128 vault;
        uint128 owed;
        uint16 maxSessions;
        uint16 openSessions;
        bool enabled;
        bool exists;
        uint128 totalDeposited;
        uint128 totalPaidOut;
        uint128 totalBurned;
        uint64 lastSweepId;
        bool holdersOnly;
    }

    struct SessionView {
        uint64 id;
        uint128 entryFee;
        uint64 openedAt;
        uint16 feeBps;
        bool finalized;
        uint128 owed;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------------------------------------------------

    // slot: server (20) + feeBps (2) + paused (1) + decimals (1) + lastSessionId (8) = 32
    address private _serverAuthority;
    uint16 private _feeBps;
    bool private _paused;
    uint8 private _decimals;
    uint64 private _lastSessionId;

    // slot: feeWallet (20) + totalGames (8)
    address private _feeWallet;
    uint64 private _totalGames;

    // slot: token (20)
    IERC20 private _token;

    // slot: holderNft (20) + holderFeeBps (2)
    address private _holderNft;
    uint16 private _holderFeeBps;

    uint128 private _totalStaked;
    uint128 private _totalPaidOut;
    uint128 private _totalFees;
    uint128 private _totalBurned;

    uint16[] private _arenaIds;
    mapping(uint16 arenaId => Arena) private _arenas;
    mapping(uint16 arenaId => mapping(address player => Session)) private _sessions;

    // ------------------------------------------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------------------------------------------

    event TokenSet(address indexed token, uint8 decimals);
    event FeeBpsSet(uint16 feeBps);
    event FeeWalletSet(address indexed feeWallet);
    event ServerAuthoritySet(address indexed serverAuthority);
    event PausedSet(bool paused);
    event ArenaCreated(uint16 indexed arenaId, uint128 entryFee, uint16 maxSessions);
    event ArenaUpdated(uint16 indexed arenaId, uint128 entryFee, uint16 maxSessions, bool enabled);
    event HolderPerksSet(address indexed nft, uint16 holderFeeBps);
    event ArenaHoldersOnlySet(uint16 indexed arenaId, bool holdersOnly);
    /// @dev The ticket's fee is `computeFee(entryFee, feeBps)` and its value `entryFee - fee` (same signature as v1).
    event Joined(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint128 entryFee, uint16 feeBps);
    /// @param payout    what the player gets (the ticket's in-game value; nothing is deducted from it).
    /// @param fee       the ticket's fee (its share of the entry fee), sent to the fee wallet with the batch.
    /// @param collected true when the payout was transferred now; false when it is held as `owed`.
    event Settled(
        uint16 indexed arenaId,
        address indexed player,
        uint64 indexed sessionId,
        uint128 payout,
        uint128 fee,
        bool collected
    );
    /// @notice A ticket that was never played, closed by the server: the full entry fee goes back (no fee).
    /// @param collected true when the amount was transferred now; false when it is held as `owed`.
    event Cancelled(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint128 amount, bool collected);
    event SettleSkipped(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint8 reason);
    event Refunded(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint128 amount);
    event Collected(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint128 amount);
    event LootBurned(uint16 indexed arenaId, uint64 indexed sweepId, uint128 amount);
    event ArenaSwept(uint16 indexed arenaId, address indexed feeWallet, uint128 amount);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    // ------------------------------------------------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------------------------------------------------

    error ZeroAddress();
    error NotServer();
    error Paused();
    error TokenNotSet();
    error TokenAlreadySet();
    error NotAContract();
    error InvalidFee();
    error InvalidArenaId();
    error ArenaExists();
    error UnknownArena();
    error EntryFeeZero();
    error InvalidMaxSessions();
    error ArenaBusy();
    error ArenaDisabled();
    error ArenaEnabled();
    error ArenaFull();
    error ArenaHasOpenSessions();
    error SessionExists();
    error NoSession();
    error RefundTooEarly();
    error InsufficientVault();
    error FeeOnTransferToken();
    error SweepIdNotIncreasing();
    error CannotRescueGameToken();
    error NativeTransferFailed();
    error RenounceDisabled();
    error HoldersOnly();

    // ------------------------------------------------------------------------------------------------------------
    // Constructor & modifiers
    // ------------------------------------------------------------------------------------------------------------

    /// @param admin           Owner (Ownable2Step): configures the contract, creates and sweeps arenas.
    /// @param serverAuthority Game server key: calls `settle` and `sweepLoot`.
    /// @param feeWallet       Receives every fee (at settle) and every swept arena vault.
    constructor(address admin, address serverAuthority, address feeWallet) Ownable(admin) {
        if (serverAuthority == address(0) || feeWallet == address(0)) revert ZeroAddress();
        _serverAuthority = serverAuthority;
        _feeWallet = feeWallet;
        _feeBps = DEFAULT_FEE_BPS;
        emit ServerAuthoritySet(serverAuthority);
        emit FeeWalletSet(feeWallet);
        emit FeeBpsSet(DEFAULT_FEE_BPS);
    }

    modifier onlyServer() {
        if (msg.sender != _serverAuthority) revert NotServer();
        _;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Sets the game token, once. Reads `decimals()` (default 18 if the call fails).
    /// @dev    The token must be a plain ERC-20: no transfer fees (a join refuses them), no rebasing, and no transfer
    ///         hooks that call the recipient (a hook could burn the gas of a `settle` batch).
    function setToken(address token) external onlyOwner {
        if (address(_token) != address(0)) revert TokenAlreadySet();
        if (token == address(0)) revert ZeroAddress();
        if (token.code.length == 0) revert NotAContract();
        uint8 dec = 18;
        try IERC20Metadata(token).decimals() returns (uint8 d) {
            dec = d;
        } catch {}
        _token = IERC20(token);
        _decimals = dec;
        emit TokenSet(token, dec);
    }

    /// @notice Fee on the entry fee of new tickets, in bps (<= 1000). Open tickets keep the rate they joined with.
    function setFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert InvalidFee();
        _feeBps = bps;
        emit FeeBpsSet(bps);
    }

    function setFeeWallet(address w) external onlyOwner {
        if (w == address(0)) revert ZeroAddress();
        _feeWallet = w;
        emit FeeWalletSet(w);
    }

    function setServerAuthority(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        _serverAuthority = s;
        emit ServerAuthoritySet(s);
    }

    /// @notice Pausing blocks `join` only: settlements, refunds and sweeps keep working.
    function setPaused(bool p) external onlyOwner {
        _paused = p;
        emit PausedSet(p);
    }

    /// @notice Creates an enabled arena. Needs the token. `id` must be non-zero and unused.
    function createArena(uint16 id, uint128 entryFee, uint16 maxSessions) external onlyOwner {
        if (address(_token) == address(0)) revert TokenNotSet();
        if (id == 0) revert InvalidArenaId();
        Arena storage a = _arenas[id];
        if (a.exists) revert ArenaExists();
        _checkArenaParams(entryFee, maxSessions);
        a.exists = true;
        a.enabled = true;
        a.entryFee = entryFee;
        a.maxSessions = maxSessions;
        _arenaIds.push(id);
        emit ArenaCreated(id, entryFee, maxSessions);
    }

    /// @notice Updates an arena. The entry fee can change only while no ticket is open (`ArenaBusy`).
    function updateArena(uint16 id, uint128 entryFee, uint16 maxSessions, bool enabled) external onlyOwner {
        Arena storage a = _arenas[id];
        if (!a.exists) revert UnknownArena();
        _checkArenaParams(entryFee, maxSessions);
        if (entryFee != a.entryFee && a.openSessions != 0) revert ArenaBusy();
        a.entryFee = entryFee;
        a.maxSessions = maxSessions;
        a.enabled = enabled;
        emit ArenaUpdated(id, entryFee, maxSessions, enabled);
    }

    /// @notice Holder perks: wallets holding at least one token of `nft` (an ERC-721) join with
    ///         `min(feeBps, holderFeeBps)` and may enter holders-only arenas. `nft == address(0)` disables the perks
    ///         (and then nobody can enter a holders-only arena). `holderFeeBps <= MAX_FEE_BPS`.
    /// @dev    A broken or hostile `nft` can never block a join: the balance check never reverts (see HolderCheck).
    function setHolderPerks(address nft, uint16 holderFeeBps) external onlyOwner {
        if (holderFeeBps > MAX_FEE_BPS) revert InvalidFee();
        if (nft != address(0) && nft.code.length == 0) revert NotAContract();
        _holderNft = nft;
        _holderFeeBps = holderFeeBps;
        emit HolderPerksSet(nft, holderFeeBps);
    }

    /// @notice Marks an arena as holders-only (`join` reverts `HoldersOnly` for wallets without the holder NFT).
    ///         Open tickets are not affected.
    function setArenaHoldersOnly(uint16 id, bool holdersOnly) external onlyOwner {
        Arena storage a = _arenas[id];
        if (!a.exists) revert UnknownArena();
        a.holdersOnly = holdersOnly;
        emit ArenaHoldersOnlySet(id, holdersOnly);
    }

    /// @notice Sends the whole vault of a disabled arena with no open ticket to the fee wallet.
    ///         Owed payouts of finalized sessions stay reserved for their players (with no open ticket no fee is
    ///         reserved: `Arena.fees` is 0).
    function sweepArena(uint16 id) external onlyOwner nonReentrant {
        Arena storage a = _arenas[id];
        if (!a.exists) revert UnknownArena();
        if (a.enabled) revert ArenaEnabled();
        if (a.openSessions != 0) revert ArenaHasOpenSessions();
        uint128 amount = a.vault;
        a.vault = 0;
        address to = _feeWallet;
        if (amount != 0) _token.safeTransfer(to, amount);
        emit ArenaSwept(id, to, amount);
    }

    /// @notice Recovers HYPE (`token == address(0)`) or a foreign ERC-20 sent here by mistake. Never the game token.
    function rescue(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            if (token == address(_token)) revert CannotRescueGameToken();
            IERC20(token).safeTransfer(to, amount);
        }
        emit Rescued(token, to, amount);
    }

    /// @notice Disabled: an ownerless arena could never be swept or reconfigured.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------------------------------------------------
    // Players
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Buys a ticket: pulls the arena's entry fee (exact amount must arrive, so fee-on-transfer tokens are
    ///         refused) and opens a session with the current fee rate (the holder rate for holders of the holder NFT).
    ///         The fee `computeFee(entryFee, feeBps)` is reserved for the fee wallet; the ticket's value
    ///         `entryFee - fee` goes into the vault. Holders-only arenas refuse other wallets (`HoldersOnly`).
    function join(uint16 arenaId) external nonReentrant {
        if (_paused) revert Paused();
        IERC20 token = _token;
        if (address(token) == address(0)) revert TokenNotSet();
        Arena storage a = _arenas[arenaId];
        if (!a.exists) revert UnknownArena();
        if (!a.enabled) revert ArenaDisabled();
        if (a.openSessions >= a.maxSessions) revert ArenaFull();
        Session storage s = _sessions[arenaId][msg.sender];
        if (s.id != 0) revert SessionExists();
        uint16 feeBps = _feeBps;
        address nft = _holderNft;
        bool holder = nft != address(0) && HolderCheck.isHolder(nft, msg.sender);
        if (a.holdersOnly && !holder) revert HoldersOnly();
        if (holder && _holderFeeBps < feeBps) feeBps = _holderFeeBps;

        uint128 entryFee = a.entryFee;
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), entryFee);
        if (token.balanceOf(address(this)) - before != entryFee) revert FeeOnTransferToken();

        uint64 sessionId = ++_lastSessionId;
        s.id = sessionId;
        s.openedAt = uint40(block.timestamp);
        s.feeBps = feeBps;
        s.finalized = false;
        s.entryFee = entryFee;
        s.owed = 0;

        uint128 fee = computeFee(entryFee, feeBps);
        a.vault += entryFee - fee;
        a.fees += fee;
        a.openSessions += 1;
        a.totalDeposited += entryFee;
        _totalStaked += entryFee;

        emit Joined(arenaId, msg.sender, sessionId, entryFee, feeBps);
    }

    /// @notice Finalized session: collects `owed` at once. Otherwise, 24 h after joining (the server never settled
    ///         it): refunds the reserved fee plus `min(entryFee - fee, vault)` (the full entry fee unless loot burns
    ///         emptied the vault) and closes the ticket.
    function refund(uint16 arenaId) external nonReentrant {
        Session storage s = _sessions[arenaId][msg.sender];
        uint64 sessionId = s.id;
        if (sessionId == 0) revert NoSession();
        Arena storage a = _arenas[arenaId];

        if (s.finalized) {
            uint128 owed = s.owed;
            delete _sessions[arenaId][msg.sender];
            a.owed -= owed;
            if (owed != 0) _token.safeTransfer(msg.sender, owed);
            emit Collected(arenaId, msg.sender, sessionId, owed);
            return;
        }

        if (block.timestamp < uint256(s.openedAt) + REFUND_DELAY) revert RefundTooEarly();
        uint128 fee = computeFee(s.entryFee, s.feeBps);
        uint128 value = s.entryFee - fee;
        if (value > a.vault) value = a.vault;
        uint128 amount = value + fee;
        delete _sessions[arenaId][msg.sender];
        a.vault -= value;
        a.fees -= fee;
        a.openSessions -= 1;
        a.totalPaidOut += amount;
        _totalPaidOut += amount;
        if (amount != 0) _token.safeTransfer(msg.sender, amount);
        emit Refunded(arenaId, msg.sender, sessionId, amount);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Server
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Settles a batch: each ticket is paid `payout` (its in-game value, nothing deducted) out of the vault
    ///         and its reserved fee goes to the fee wallet (one transfer for the whole batch). An item that cannot be
    ///         settled is skipped with `SettleSkipped(reason)`; a failing fee transfer reverts the whole batch. When
    ///         the player's transfer fails the session is finalized and the payout is held as `owed` (collected
    ///         with `refund`).
    function settle(Settlement[] calldata items) external onlyServer nonReentrant {
        IERC20 token = _token;
        uint256 n = items.length;
        uint128 fees;
        for (uint256 i; i < n; ++i) {
            fees += _settleOne(token, items[i]);
        }
        if (fees != 0) token.safeTransfer(_feeWallet, fees);
    }

    /// @notice Cancels tickets that were never played (bought, never seated in a room): each gets its full entry
    ///         fee back (the reserved fee is returned, no fee is taken). Skips like `settle` (`SettleSkipped`); a
    ///         failed transfer finalizes the session with the amount held as `owed`.
    function cancel(SessionRef[] calldata items) external onlyServer nonReentrant {
        IERC20 token = _token;
        uint256 n = items.length;
        for (uint256 i; i < n; ++i) {
            _cancelOne(token, items[i]);
        }
    }

    /// @notice Burns floor loot of an arena (transfer to 0x…dEaD). `sweepId` must be larger than the last one, so a
    ///         retried sweep can never burn twice.
    function sweepLoot(uint16 arenaId, uint64 sweepId, uint128 amount) external onlyServer nonReentrant {
        Arena storage a = _arenas[arenaId];
        if (!a.exists) revert UnknownArena();
        if (sweepId <= a.lastSweepId) revert SweepIdNotIncreasing();
        if (amount > a.vault) revert InsufficientVault();
        a.lastSweepId = sweepId;
        a.vault -= amount;
        a.totalBurned += amount;
        _totalBurned += amount;
        if (amount != 0) _token.safeTransfer(BURN_ADDRESS, amount);
        emit LootBurned(arenaId, sweepId, amount);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------------------------------------------

    function config() external view returns (ConfigView memory v) {
        v.admin = owner();
        v.pendingAdmin = pendingOwner();
        v.serverAuthority = _serverAuthority;
        v.feeWallet = _feeWallet;
        v.token = address(_token);
        v.decimals = _decimals;
        v.feeBps = _feeBps;
        v.paused = _paused;
        v.totalSessions = _lastSessionId;
        v.totalGames = _totalGames;
        v.totalStaked = _totalStaked;
        v.totalPaidOut = _totalPaidOut;
        v.totalFees = _totalFees;
        v.totalBurned = _totalBurned;
        v.holderNft = _holderNft;
        v.holderFeeBps = _holderFeeBps;
    }

    function arenaIds() external view returns (uint16[] memory) {
        return _arenaIds;
    }

    function getArena(uint16 id) external view returns (ArenaView memory v) {
        Arena storage a = _arenas[id];
        v.id = id;
        v.entryFee = a.entryFee;
        v.vault = a.vault;
        v.owed = a.owed;
        v.maxSessions = a.maxSessions;
        v.openSessions = a.openSessions;
        v.enabled = a.enabled;
        v.exists = a.exists;
        v.totalDeposited = a.totalDeposited;
        v.totalPaidOut = a.totalPaidOut;
        v.totalBurned = a.totalBurned;
        v.lastSweepId = a.lastSweepId;
        v.holdersOnly = a.holdersOnly;
    }

    /// @notice True when `player` holds the holder NFT (false when the perks are off or the NFT misbehaves).
    function isHolder(address player) public view returns (bool) {
        return HolderCheck.isHolder(_holderNft, player);
    }

    /// @notice The fee rate a ticket bought by `player` now would get.
    function feeBpsFor(address player) external view returns (uint16) {
        uint16 feeBps = _feeBps;
        if (_holderFeeBps < feeBps && isHolder(player)) return _holderFeeBps;
        return feeBps;
    }

    function getSession(uint16 arenaId, address player) external view returns (SessionView memory v) {
        Session storage s = _sessions[arenaId][player];
        v.id = s.id;
        v.entryFee = s.entryFee;
        v.openedAt = s.openedAt;
        v.feeBps = s.feeBps;
        v.finalized = s.finalized;
        v.owed = s.owed;
    }

    /// @notice The fee of a ticket: `floor(entryFee * feeBps / 10 000)`. Its value is `entryFee - fee`.
    function computeFee(uint128 entryFee, uint16 feeBps) public pure returns (uint128) {
        return uint128((uint256(entryFee) * feeBps) / BPS);
    }

    /// @notice 2: fee on entry (an arena without this view is version 1, fee on profit).
    function version() external pure returns (uint16) {
        return VERSION;
    }

    /// @notice True: the fee is taken from every played ticket's entry fee, never from profit.
    function feeOnEntry() external pure returns (bool) {
        return true;
    }

    /// @notice Fees reserved for the open tickets of an arena (not spendable by settlements or loot burns).
    function arenaFees(uint16 id) external view returns (uint128) {
        return _arenas[id].fees;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------------------

    /// @return fee the ticket's fee, owed to the fee wallet (0 when skipped).
    function _settleOne(IERC20 token, Settlement calldata it) private returns (uint128 fee) {
        Arena storage a = _arenas[it.arenaId];
        if (!a.exists) return _skip(it.arenaId, it.player, it.sessionId, SKIP_UNKNOWN_ARENA);
        Session storage s = _sessions[it.arenaId][it.player];
        if (s.id == 0 || s.id != it.sessionId) return _skip(it.arenaId, it.player, it.sessionId, SKIP_SESSION_MISMATCH);
        if (s.finalized) return _skip(it.arenaId, it.player, it.sessionId, SKIP_FINALIZED);
        uint128 payout = it.payout;
        if (payout > a.vault) return _skip(it.arenaId, it.player, it.sessionId, SKIP_INSUFFICIENT_VAULT);

        uint128 entryFee = s.entryFee;
        uint16 feeBps = s.feeBps;
        uint40 openedAt = s.openedAt;
        fee = computeFee(entryFee, feeBps);

        // Effects first: the ticket is closed before any transfer.
        delete _sessions[it.arenaId][it.player];
        a.vault -= payout;
        a.fees -= fee;
        a.openSessions -= 1;
        a.totalPaidOut += payout;
        _totalPaidOut += payout;
        _totalFees += fee;
        _totalGames += 1;

        bool collected = _payOrHold(token, a, it.arenaId, it.player, it.sessionId, openedAt, feeBps, entryFee, payout);
        emit Settled(it.arenaId, it.player, it.sessionId, payout, fee, collected);
    }

    function _cancelOne(IERC20 token, SessionRef calldata it) private {
        Arena storage a = _arenas[it.arenaId];
        if (!a.exists) {
            _skip(it.arenaId, it.player, it.sessionId, SKIP_UNKNOWN_ARENA);
            return;
        }
        Session storage s = _sessions[it.arenaId][it.player];
        if (s.id == 0 || s.id != it.sessionId) {
            _skip(it.arenaId, it.player, it.sessionId, SKIP_SESSION_MISMATCH);
            return;
        }
        if (s.finalized) {
            _skip(it.arenaId, it.player, it.sessionId, SKIP_FINALIZED);
            return;
        }
        uint128 entryFee = s.entryFee;
        uint16 feeBps = s.feeBps;
        uint40 openedAt = s.openedAt;
        uint128 fee = computeFee(entryFee, feeBps);
        uint128 value = entryFee - fee;
        if (value > a.vault) {
            _skip(it.arenaId, it.player, it.sessionId, SKIP_INSUFFICIENT_VAULT);
            return;
        }

        delete _sessions[it.arenaId][it.player];
        a.vault -= value;
        a.fees -= fee;
        a.openSessions -= 1;
        a.totalPaidOut += entryFee;
        _totalPaidOut += entryFee;

        bool collected = _payOrHold(token, a, it.arenaId, it.player, it.sessionId, openedAt, feeBps, entryFee, entryFee);
        emit Cancelled(it.arenaId, it.player, it.sessionId, entryFee, collected);
    }

    /// @dev Transfers `amount` to the player. When that fails the session is re-opened as finalized and the amount is
    ///      held as `owed` (two-phase settle: the result is final, the player collects it with `refund`).
    function _payOrHold(
        IERC20 token,
        Arena storage a,
        uint16 arenaId,
        address player,
        uint64 sessionId,
        uint40 openedAt,
        uint16 feeBps,
        uint128 entryFee,
        uint128 amount
    ) private returns (bool) {
        if (amount == 0 || token.trySafeTransfer(player, amount)) return true;
        Session storage f = _sessions[arenaId][player];
        f.id = sessionId;
        f.openedAt = openedAt;
        f.feeBps = feeBps;
        f.finalized = true;
        f.entryFee = entryFee;
        f.owed = amount;
        a.owed += amount;
        return false;
    }

    function _skip(uint16 arenaId, address player, uint64 sessionId, uint8 reason) private returns (uint128) {
        emit SettleSkipped(arenaId, player, sessionId, reason);
        return 0;
    }

    function _checkArenaParams(uint128 entryFee, uint16 maxSessions) private pure {
        if (entryFee == 0) revert EntryFeeZero();
        if (maxSessions < MIN_ARENA_SESSIONS || maxSessions > MAX_ARENA_SESSIONS) revert InvalidMaxSessions();
    }
}
