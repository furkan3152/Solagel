// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ElymumArena
/// @notice Ticket escrow for the Elymum arenas on Elysium. Players pay an entry fee into an arena vault with
///         `join`; at the bell the game server pays every ticket its value with `settle` (fee on profit only) and
///         burns floor loot with `sweepLoot`. A ticket the server never settles can be refunded after 24 h.
/// @dev    Accounting is internal: `Arena.vault` is what settlements and refunds may spend and `Arena.owed` is held
///         for players whose transfer failed (two-phase settle). The contract's token balance is always
///         `sum(vault) + sum(owed)` plus anything sent to it directly (which stays locked: `rescue` never touches the
///         game token). No `immutable` variables, so the runtime bytecode is identical for every deployment.
contract ElymumArena is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Basis-point denominator (100 %).
    uint16 public constant BPS = 10_000;
    /// @notice Upper bound of `feeBps` (10 %).
    uint16 public constant MAX_FEE_BPS = 1_000;
    /// @notice Fee on profit at deploy (5 %).
    uint16 public constant DEFAULT_FEE_BPS = 500;
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
        uint128 totalDeposited; // slot 2
        uint128 totalPaidOut; //   slot 2: settled payouts (fee included) + refunds of unsettled tickets
        uint128 totalBurned; //    slot 3
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
    event Joined(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint128 entryFee, uint16 feeBps);
    /// @param collected true when the player's share was transferred now; false when it is held as `owed`.
    event Settled(
        uint16 indexed arenaId,
        address indexed player,
        uint64 indexed sessionId,
        uint128 payout,
        uint128 fee,
        bool collected
    );
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

    // ------------------------------------------------------------------------------------------------------------
    // Constructor & modifiers
    // ------------------------------------------------------------------------------------------------------------

    /// @param admin           Owner (Ownable2Step): configures the contract, creates and sweeps arenas.
    /// @param serverAuthority Game server key: calls `settle` and `sweepLoot`.
    /// @param feeWallet       Receives every fee and every swept arena vault.
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

    /// @notice Fee on profit for new tickets, in bps (<= 1000). Open tickets keep the rate they joined with.
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

    /// @notice Sends the whole vault of a disabled arena with no open ticket to the fee wallet.
    ///         Owed payouts of finalized sessions stay reserved for their players.
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
    ///         refused) and opens a session with the current fee rate.
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

        uint128 entryFee = a.entryFee;
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), entryFee);
        if (token.balanceOf(address(this)) - before != entryFee) revert FeeOnTransferToken();

        uint64 sessionId = ++_lastSessionId;
        uint16 feeBps = _feeBps;
        s.id = sessionId;
        s.openedAt = uint40(block.timestamp);
        s.feeBps = feeBps;
        s.finalized = false;
        s.entryFee = entryFee;
        s.owed = 0;

        a.vault += entryFee;
        a.openSessions += 1;
        a.totalDeposited += entryFee;
        _totalStaked += entryFee;

        emit Joined(arenaId, msg.sender, sessionId, entryFee, feeBps);
    }

    /// @notice Finalized session: collects `owed` at once. Otherwise, 24 h after joining: refunds
    ///         `min(entryFee, vault)` and closes the ticket.
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
        uint128 amount = s.entryFee < a.vault ? s.entryFee : a.vault;
        delete _sessions[arenaId][msg.sender];
        a.vault -= amount;
        a.openSessions -= 1;
        a.totalPaidOut += amount;
        _totalPaidOut += amount;
        if (amount != 0) _token.safeTransfer(msg.sender, amount);
        emit Refunded(arenaId, msg.sender, sessionId, amount);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Server
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Settles a batch. An item that cannot be settled is skipped with `SettleSkipped(reason)`; a failing fee
    ///         transfer reverts the whole batch. When the player's transfer fails the session is finalized and the
    ///         player's share is held as `owed` (collected with `refund`).
    function settle(Settlement[] calldata items) external onlyServer nonReentrant {
        IERC20 token = _token;
        address feeWallet = _feeWallet;
        uint256 n = items.length;
        for (uint256 i; i < n; ++i) {
            _settleOne(token, feeWallet, items[i]);
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

    /// @notice `floor((payout - entryFee)+ * feeBps / 10 000)`.
    function computeFee(uint128 payout, uint128 entryFee, uint16 feeBps) public pure returns (uint128) {
        if (payout <= entryFee) return 0;
        return uint128((uint256(payout - entryFee) * feeBps) / BPS);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------------------

    function _settleOne(IERC20 token, address feeWallet, Settlement calldata it) private {
        Arena storage a = _arenas[it.arenaId];
        if (!a.exists) return _skip(it, SKIP_UNKNOWN_ARENA);
        Session storage s = _sessions[it.arenaId][it.player];
        if (s.id == 0 || s.id != it.sessionId) return _skip(it, SKIP_SESSION_MISMATCH);
        if (s.finalized) return _skip(it, SKIP_FINALIZED);
        uint128 payout = it.payout;
        if (payout > a.vault) return _skip(it, SKIP_INSUFFICIENT_VAULT);

        uint128 entryFee = s.entryFee;
        uint16 feeBps = s.feeBps;
        uint40 openedAt = s.openedAt;
        uint128 fee = computeFee(payout, entryFee, feeBps);
        uint128 toPlayer = payout - fee;

        // Effects first: the ticket is closed before any transfer.
        delete _sessions[it.arenaId][it.player];
        a.vault -= payout;
        a.openSessions -= 1;
        a.totalPaidOut += payout;
        _totalPaidOut += payout;
        _totalFees += fee;
        _totalGames += 1;

        if (fee != 0) token.safeTransfer(feeWallet, fee);

        bool collected = true;
        if (toPlayer != 0 && !token.trySafeTransfer(it.player, toPlayer)) {
            collected = false;
            // Two-phase settle: the result is final, the player's share stays reserved until `refund`.
            Session storage f = _sessions[it.arenaId][it.player];
            f.id = it.sessionId;
            f.openedAt = openedAt;
            f.feeBps = feeBps;
            f.finalized = true;
            f.entryFee = entryFee;
            f.owed = toPlayer;
            a.owed += toPlayer;
        }
        emit Settled(it.arenaId, it.player, it.sessionId, payout, fee, collected);
    }

    function _skip(Settlement calldata it, uint8 reason) private {
        emit SettleSkipped(it.arenaId, it.player, it.sessionId, reason);
    }

    function _checkArenaParams(uint128 entryFee, uint16 maxSessions) private pure {
        if (entryFee == 0) revert EntryFeeZero();
        if (maxSessions < MIN_ARENA_SESSIONS || maxSessions > MAX_ARENA_SESSIONS) revert InvalidMaxSessions();
    }
}
