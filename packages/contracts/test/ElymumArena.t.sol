// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ElymumArena} from "../contracts/ElymumArena.sol";
import {
    MockERC20,
    FeeOnTransferToken,
    BlockingToken,
    NoDecimalsToken,
    ReentrantToken
} from "../contracts/test/MockTokens.sol";
import {RejectEther} from "../contracts/test/Actors.sol";

contract ElymumArenaTest is Test {
    ElymumArena internal arena;
    MockERC20 internal token;

    address internal admin = makeAddr("admin");
    address internal server = makeAddr("server");
    address internal feeWallet = makeAddr("feeWallet");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    uint16 internal constant ID = 1;
    uint128 internal constant FEE = 1_000 ether;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    event TokenSet(address indexed token, uint8 decimals);
    event FeeBpsSet(uint16 feeBps);
    event FeeWalletSet(address indexed feeWallet);
    event ServerAuthoritySet(address indexed serverAuthority);
    event PausedSet(bool paused);
    event ArenaCreated(uint16 indexed arenaId, uint128 entryFee, uint16 maxSessions);
    event ArenaUpdated(uint16 indexed arenaId, uint128 entryFee, uint16 maxSessions, bool enabled);
    event Joined(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint128 entryFee, uint16 feeBps);
    event Settled(
        uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint128 payout, uint128 fee, bool collected
    );
    event SettleSkipped(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint8 reason);
    event Refunded(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint128 amount);
    event Collected(uint16 indexed arenaId, address indexed player, uint64 indexed sessionId, uint128 amount);
    event LootBurned(uint16 indexed arenaId, uint64 indexed sweepId, uint128 amount);
    event ArenaSwept(uint16 indexed arenaId, address indexed feeWallet, uint128 amount);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new MockERC20("Elymum", "ELYMUM", 18);
        arena = new ElymumArena(admin, server, feeWallet);
        vm.startPrank(admin);
        arena.setToken(address(token));
        arena.createArena(ID, FEE, 300);
        vm.stopPrank();
        _fund(alice);
        _fund(bob);
        _fund(carol);
    }

    // ---------------------------------------------------------------- helpers

    function _fund(address who) internal {
        token.mint(who, 1_000_000 ether);
        vm.prank(who);
        token.approve(address(arena), type(uint256).max);
    }

    function _join(address who) internal returns (uint64) {
        vm.prank(who);
        arena.join(ID);
        return arena.getSession(ID, who).id;
    }

    function _one(uint16 id, address player, uint64 sid, uint128 payout)
        internal
        pure
        returns (ElymumArena.Settlement[] memory items)
    {
        items = new ElymumArena.Settlement[](1);
        items[0] = ElymumArena.Settlement(id, player, sid, payout);
    }

    function _settle(ElymumArena.Settlement[] memory items) internal {
        vm.prank(server);
        arena.settle(items);
    }

    function _unauthorized(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    // ---------------------------------------------------------------- constructor & config

    function test_constructor_setsConfig() public {
        ElymumArena a = new ElymumArena(admin, server, feeWallet);
        ElymumArena.ConfigView memory c = a.config();
        assertEq(c.admin, admin);
        assertEq(c.pendingAdmin, address(0));
        assertEq(c.serverAuthority, server);
        assertEq(c.feeWallet, feeWallet);
        assertEq(c.token, address(0));
        assertEq(c.decimals, 0);
        assertEq(c.feeBps, 500);
        assertFalse(c.paused);
        assertEq(c.totalSessions, 0);
        assertEq(a.arenaIds().length, 0);
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ElymumArena(address(0), server, feeWallet);
        vm.expectRevert(ElymumArena.ZeroAddress.selector);
        new ElymumArena(admin, address(0), feeWallet);
        vm.expectRevert(ElymumArena.ZeroAddress.selector);
        new ElymumArena(admin, server, address(0));
    }

    function test_setToken_once_readsDecimals() public {
        ElymumArena a = new ElymumArena(admin, server, feeWallet);
        MockERC20 six = new MockERC20("Six", "SIX", 6);
        vm.expectEmit(address(a));
        emit TokenSet(address(six), 6);
        vm.prank(admin);
        a.setToken(address(six));
        assertEq(a.config().token, address(six));
        assertEq(a.config().decimals, 6);

        vm.prank(admin);
        vm.expectRevert(ElymumArena.TokenAlreadySet.selector);
        a.setToken(address(token));
    }

    function test_setToken_defaultsTo18Decimals() public {
        ElymumArena a = new ElymumArena(admin, server, feeWallet);
        NoDecimalsToken nd = new NoDecimalsToken();
        vm.prank(admin);
        a.setToken(address(nd));
        assertEq(a.config().decimals, 18);
    }

    function test_setToken_reverts() public {
        ElymumArena a = new ElymumArena(admin, server, feeWallet);
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        a.setToken(address(token));
        vm.prank(admin);
        vm.expectRevert(ElymumArena.ZeroAddress.selector);
        a.setToken(address(0));
        vm.prank(admin);
        vm.expectRevert(ElymumArena.NotAContract.selector);
        a.setToken(alice);
    }

    function test_setFeeBps() public {
        vm.expectEmit(address(arena));
        emit FeeBpsSet(1_000);
        vm.prank(admin);
        arena.setFeeBps(1_000);
        assertEq(arena.config().feeBps, 1_000);
        vm.prank(admin);
        arena.setFeeBps(0);
        assertEq(arena.config().feeBps, 0);
        vm.prank(admin);
        vm.expectRevert(ElymumArena.InvalidFee.selector);
        arena.setFeeBps(1_001);
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        arena.setFeeBps(1);
    }

    function test_setFeeWallet() public {
        vm.expectEmit(address(arena));
        emit FeeWalletSet(bob);
        vm.prank(admin);
        arena.setFeeWallet(bob);
        assertEq(arena.config().feeWallet, bob);
        vm.prank(admin);
        vm.expectRevert(ElymumArena.ZeroAddress.selector);
        arena.setFeeWallet(address(0));
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        arena.setFeeWallet(bob);
    }

    function test_setServerAuthority() public {
        vm.expectEmit(address(arena));
        emit ServerAuthoritySet(bob);
        vm.prank(admin);
        arena.setServerAuthority(bob);
        assertEq(arena.config().serverAuthority, bob);
        // The old server key is out.
        vm.prank(server);
        vm.expectRevert(ElymumArena.NotServer.selector);
        arena.settle(new ElymumArena.Settlement[](0));
        vm.prank(admin);
        vm.expectRevert(ElymumArena.ZeroAddress.selector);
        arena.setServerAuthority(address(0));
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        arena.setServerAuthority(bob);
    }

    function test_pause_blocksJoinsOnly() public {
        uint64 sid = _join(alice);
        _join(bob);
        vm.expectEmit(address(arena));
        emit PausedSet(true);
        vm.prank(admin);
        arena.setPaused(true);
        assertTrue(arena.config().paused);

        vm.prank(carol);
        vm.expectRevert(ElymumArena.Paused.selector);
        arena.join(ID);

        // Settle, refund and sweeps keep working.
        _settle(_one(ID, alice, sid, FEE));
        assertEq(arena.getSession(ID, alice).id, 0);
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        arena.refund(ID);
        vm.prank(server);
        arena.sweepLoot(ID, 1, 0);

        vm.prank(admin);
        arena.setPaused(false);
        _join(carol);

        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        arena.setPaused(true);
    }

    // ---------------------------------------------------------------- arenas

    function test_createArena() public {
        vm.expectEmit(address(arena));
        emit ArenaCreated(2, 10_000 ether, 2_000);
        vm.prank(admin);
        arena.createArena(2, 10_000 ether, 2_000);
        ElymumArena.ArenaView memory v = arena.getArena(2);
        assertEq(v.id, 2);
        assertEq(v.entryFee, 10_000 ether);
        assertEq(v.maxSessions, 2_000);
        assertTrue(v.enabled);
        assertTrue(v.exists);
        assertEq(v.vault, 0);
        uint16[] memory ids = arena.arenaIds();
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_createArena_reverts() public {
        ElymumArena fresh = new ElymumArena(admin, server, feeWallet);
        vm.prank(admin);
        vm.expectRevert(ElymumArena.TokenNotSet.selector);
        fresh.createArena(1, FEE, 300);

        vm.startPrank(admin);
        vm.expectRevert(ElymumArena.InvalidArenaId.selector);
        arena.createArena(0, FEE, 300);
        vm.expectRevert(ElymumArena.ArenaExists.selector);
        arena.createArena(ID, FEE, 300);
        vm.expectRevert(ElymumArena.EntryFeeZero.selector);
        arena.createArena(2, 0, 300);
        vm.expectRevert(ElymumArena.InvalidMaxSessions.selector);
        arena.createArena(2, FEE, 1);
        vm.expectRevert(ElymumArena.InvalidMaxSessions.selector);
        arena.createArena(2, FEE, 2_001);
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        arena.createArena(2, FEE, 300);
    }

    function test_updateArena() public {
        _join(alice);
        // Capacity and enabled change while sessions are open; the fee does not.
        vm.expectEmit(address(arena));
        emit ArenaUpdated(ID, FEE, 50, false);
        vm.prank(admin);
        arena.updateArena(ID, FEE, 50, false);
        ElymumArena.ArenaView memory v = arena.getArena(ID);
        assertEq(v.maxSessions, 50);
        assertFalse(v.enabled);

        vm.prank(admin);
        vm.expectRevert(ElymumArena.ArenaBusy.selector);
        arena.updateArena(ID, FEE + 1, 50, true);

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        arena.refund(ID);
        vm.prank(admin);
        arena.updateArena(ID, FEE * 2, 50, true);
        assertEq(arena.getArena(ID).entryFee, FEE * 2);
    }

    function test_updateArena_reverts() public {
        vm.startPrank(admin);
        vm.expectRevert(ElymumArena.UnknownArena.selector);
        arena.updateArena(9, FEE, 300, true);
        vm.expectRevert(ElymumArena.EntryFeeZero.selector);
        arena.updateArena(ID, 0, 300, true);
        vm.expectRevert(ElymumArena.InvalidMaxSessions.selector);
        arena.updateArena(ID, FEE, 1, true);
        vm.expectRevert(ElymumArena.InvalidMaxSessions.selector);
        arena.updateArena(ID, FEE, 2_001, true);
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        arena.updateArena(ID, FEE, 300, true);
    }

    function test_sweepArena_onlyDisabledAndIdle() public {
        uint64 sid = _join(alice);
        _join(bob);
        vm.prank(admin);
        vm.expectRevert(ElymumArena.ArenaEnabled.selector);
        arena.sweepArena(ID);

        vm.prank(admin);
        arena.updateArena(ID, FEE, 300, false);
        vm.prank(admin);
        vm.expectRevert(ElymumArena.ArenaHasOpenSessions.selector);
        arena.sweepArena(ID);

        _settle(_one(ID, alice, sid, FEE / 2));
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        arena.refund(ID); // takes FEE back, FEE/2 remains
        uint256 before = token.balanceOf(feeWallet);
        vm.expectEmit(address(arena));
        emit ArenaSwept(ID, feeWallet, FEE / 2);
        vm.prank(admin);
        arena.sweepArena(ID);
        assertEq(token.balanceOf(feeWallet) - before, FEE / 2);
        assertEq(arena.getArena(ID).vault, 0);
        assertEq(token.balanceOf(address(arena)), 0);

        // Sweeping an empty vault is a no-op.
        vm.prank(admin);
        arena.sweepArena(ID);

        vm.prank(admin);
        vm.expectRevert(ElymumArena.UnknownArena.selector);
        arena.sweepArena(7);
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        arena.sweepArena(ID);
    }

    function test_sweepArena_keepsOwedForFinalizedPlayers() public {
        (ElymumArena a, BlockingToken blk) = _blockingArena();
        vm.prank(alice);
        a.join(ID);
        vm.prank(bob);
        a.join(ID);
        blk.setBlocked(alice, true);
        ElymumArena.Settlement[] memory items = _one(ID, alice, a.getSession(ID, alice).id, 1_500 ether);
        vm.prank(server);
        a.settle(items);
        assertTrue(a.getSession(ID, alice).finalized);

        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        a.refund(ID); // min(1000, 500)
        assertEq(a.getArena(ID).vault, 0);

        // A finalized (blocked) player does not keep the arena busy, and the owed amount is not swept.
        vm.prank(admin);
        a.updateArena(ID, FEE, 300, false);
        vm.prank(admin);
        a.sweepArena(ID);
        uint128 owed = a.getSession(ID, alice).owed;
        assertEq(a.getArena(ID).owed, owed);
        assertEq(blk.balanceOf(address(a)), owed);

        blk.setBlocked(alice, false);
        vm.prank(alice);
        a.refund(ID);
        assertEq(blk.balanceOf(address(a)), 0);
    }

    // ---------------------------------------------------------------- rescue & ownership

    function test_rescue_nativeAndForeignTokens() public {
        vm.deal(address(arena), 3 ether);
        vm.expectEmit(address(arena));
        emit Rescued(address(0), bob, 2 ether);
        vm.prank(admin);
        arena.rescue(address(0), bob, 2 ether);
        assertEq(bob.balance, 2 ether);

        MockERC20 other = new MockERC20("Other", "OTH", 18);
        other.mint(address(arena), 5 ether);
        vm.prank(admin);
        arena.rescue(address(other), bob, 5 ether);
        assertEq(other.balanceOf(bob), 5 ether);
    }

    function test_rescue_neverTheGameToken() public {
        _join(alice);
        token.mint(address(arena), 1 ether); // a donation is locked too
        vm.prank(admin);
        vm.expectRevert(ElymumArena.CannotRescueGameToken.selector);
        arena.rescue(address(token), admin, 1);
    }

    function test_rescue_reverts() public {
        vm.deal(address(arena), 1 ether);
        RejectEther rej = new RejectEther();
        vm.startPrank(admin);
        vm.expectRevert(ElymumArena.ZeroAddress.selector);
        arena.rescue(address(0), address(0), 1);
        vm.expectRevert(ElymumArena.NativeTransferFailed.selector);
        arena.rescue(address(0), address(rej), 1);
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        arena.rescue(address(0), stranger, 1);
    }

    function test_rescue_nativeBeforeTokenIsSet() public {
        ElymumArena a = new ElymumArena(admin, server, feeWallet);
        vm.deal(address(a), 1 ether);
        vm.prank(admin);
        a.rescue(address(0), bob, 1 ether);
        assertEq(bob.balance, 1 ether);
    }

    function test_ownable2Step() public {
        vm.prank(admin);
        arena.transferOwnership(bob);
        assertEq(arena.owner(), admin);
        assertEq(arena.pendingOwner(), bob);
        assertEq(arena.config().pendingAdmin, bob);

        vm.prank(carol);
        vm.expectRevert(_unauthorized(carol));
        arena.acceptOwnership();

        vm.prank(bob);
        arena.acceptOwnership();
        assertEq(arena.owner(), bob);
        assertEq(arena.config().admin, bob);

        vm.prank(admin);
        vm.expectRevert(_unauthorized(admin));
        arena.setPaused(true);
    }

    function test_renounceOwnership_disabled() public {
        vm.prank(admin);
        vm.expectRevert(ElymumArena.RenounceDisabled.selector);
        arena.renounceOwnership();
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        arena.renounceOwnership();
        assertEq(arena.owner(), admin);
    }

    // ---------------------------------------------------------------- join

    function test_join_opensSession() public {
        vm.expectEmit(address(arena));
        emit Joined(ID, alice, 1, FEE, 500);
        vm.prank(alice);
        arena.join(ID);

        ElymumArena.SessionView memory s = arena.getSession(ID, alice);
        assertEq(s.id, 1);
        assertEq(s.entryFee, FEE);
        assertEq(s.openedAt, block.timestamp);
        assertEq(s.feeBps, 500);
        assertFalse(s.finalized);
        assertEq(s.owed, 0);

        ElymumArena.ArenaView memory v = arena.getArena(ID);
        assertEq(v.vault, FEE);
        assertEq(v.openSessions, 1);
        assertEq(v.totalDeposited, FEE);
        assertEq(token.balanceOf(address(arena)), FEE);
        assertEq(arena.config().totalStaked, FEE);
        assertEq(arena.config().totalSessions, 1);
    }

    function test_join_sessionIdsAreGlobal() public {
        vm.prank(admin);
        arena.createArena(2, 5 ether, 300);
        assertEq(_join(alice), 1);
        vm.prank(bob);
        arena.join(2);
        assertEq(arena.getSession(2, bob).id, 2);
        assertEq(_join(bob), 3);
        vm.prank(alice);
        arena.join(2);
        assertEq(arena.getSession(2, alice).id, 4);
    }

    function test_join_reverts() public {
        // token not set
        ElymumArena fresh = new ElymumArena(admin, server, feeWallet);
        vm.prank(alice);
        vm.expectRevert(ElymumArena.TokenNotSet.selector);
        fresh.join(ID);
        // unknown arena
        vm.prank(alice);
        vm.expectRevert(ElymumArena.UnknownArena.selector);
        arena.join(42);
        // one session per player per arena
        _join(alice);
        vm.prank(alice);
        vm.expectRevert(ElymumArena.SessionExists.selector);
        arena.join(ID);
        // disabled
        vm.prank(admin);
        arena.updateArena(ID, FEE, 300, false);
        vm.prank(bob);
        vm.expectRevert(ElymumArena.ArenaDisabled.selector);
        arena.join(ID);
        // full
        vm.prank(admin);
        arena.updateArena(ID, FEE, 2, true);
        _join(bob);
        vm.prank(carol);
        vm.expectRevert(ElymumArena.ArenaFull.selector);
        arena.join(ID);
        // no allowance
        vm.prank(admin);
        arena.updateArena(ID, FEE, 300, true);
        vm.prank(carol);
        token.approve(address(arena), FEE - 1);
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(arena), FEE - 1, FEE)
        );
        arena.join(ID);
    }

    function test_join_refusesFeeOnTransferToken() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        ElymumArena a = new ElymumArena(admin, server, feeWallet);
        vm.startPrank(admin);
        a.setToken(address(fot));
        a.createArena(ID, FEE, 300);
        vm.stopPrank();
        fot.mint(alice, 10 * FEE);
        vm.prank(alice);
        fot.approve(address(a), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(ElymumArena.FeeOnTransferToken.selector);
        a.join(ID);
        // With the fee switched off it works.
        fot.setFeeBps(0);
        vm.prank(alice);
        a.join(ID);
        assertEq(a.getArena(ID).vault, FEE);
    }

    // ---------------------------------------------------------------- settle

    function test_settle_feeOnProfitOnly() public {
        uint64 sid = _join(alice);
        _join(bob); // fills the vault so a 2x payout fits
        uint256 a0 = token.balanceOf(alice);
        vm.expectEmit(address(arena));
        emit Settled(ID, alice, sid, 2 * FEE, 50 ether, true);
        _settle(_one(ID, alice, sid, 2 * FEE));
        // 1000 ticket, 2000 payout, 5 %: fee 50, player 1950.
        assertEq(token.balanceOf(alice) - a0, 1_950 ether);
        assertEq(token.balanceOf(feeWallet), 50 ether);
        ElymumArena.ArenaView memory v = arena.getArena(ID);
        assertEq(v.vault, 0);
        assertEq(v.openSessions, 1);
        assertEq(v.totalPaidOut, 2 * FEE);
        assertEq(arena.getSession(ID, alice).id, 0);
        ElymumArena.ConfigView memory c = arena.config();
        assertEq(c.totalGames, 1);
        assertEq(c.totalFees, 50 ether);
        assertEq(c.totalPaidOut, 2 * FEE);
    }

    function test_settle_lossPaysNoFee() public {
        uint64 sid = _join(alice);
        uint256 a0 = token.balanceOf(alice);
        _settle(_one(ID, alice, sid, 400 ether));
        assertEq(token.balanceOf(alice) - a0, 400 ether);
        assertEq(token.balanceOf(feeWallet), 0);
        assertEq(arena.getArena(ID).vault, 600 ether);
    }

    function test_settle_zeroPayoutClosesTicket() public {
        uint64 sid = _join(alice);
        uint256 a0 = token.balanceOf(alice);
        vm.expectEmit(address(arena));
        emit Settled(ID, alice, sid, 0, 0, true);
        _settle(_one(ID, alice, sid, 0));
        assertEq(token.balanceOf(alice), a0);
        assertEq(arena.getSession(ID, alice).id, 0);
        assertEq(arena.getArena(ID).openSessions, 0);
        assertEq(arena.getArena(ID).vault, FEE);
    }

    function test_settle_feeRateFixedAtJoin() public {
        uint64 sid = _join(alice);
        _join(bob);
        vm.prank(admin);
        arena.setFeeBps(1_000);
        _settle(_one(ID, alice, sid, 2 * FEE));
        assertEq(token.balanceOf(feeWallet), 50 ether); // 5 %, not 10 %
        assertEq(arena.getSession(ID, bob).feeBps, 500);
        _join(alice);
        assertEq(arena.getSession(ID, alice).feeBps, 1_000);
    }

    function test_settle_onlyServer() public {
        uint64 sid = _join(alice);
        vm.prank(admin);
        vm.expectRevert(ElymumArena.NotServer.selector);
        arena.settle(_one(ID, alice, sid, 0));
    }

    function test_settle_skipReasons() public {
        uint64 sa = _join(alice);
        uint64 sb = _join(bob);
        ElymumArena.Settlement[] memory items = new ElymumArena.Settlement[](5);
        items[0] = ElymumArena.Settlement(9, alice, sa, 1); // unknown arena
        items[1] = ElymumArena.Settlement(ID, carol, 77, 1); // no session
        items[2] = ElymumArena.Settlement(ID, alice, sa + 100, 1); // wrong id
        items[3] = ElymumArena.Settlement(ID, bob, sb, 3 * FEE); // over the vault
        items[4] = ElymumArena.Settlement(ID, alice, sa, FEE); // valid
        vm.expectEmit(address(arena));
        emit SettleSkipped(9, alice, sa, 1);
        vm.expectEmit(address(arena));
        emit SettleSkipped(ID, carol, 77, 2);
        vm.expectEmit(address(arena));
        emit SettleSkipped(ID, alice, sa + 100, 2);
        vm.expectEmit(address(arena));
        emit SettleSkipped(ID, bob, sb, 4);
        vm.expectEmit(address(arena));
        emit Settled(ID, alice, sa, FEE, 0, true);
        _settle(items);
        assertEq(arena.getSession(ID, bob).id, sb); // skipped, still open
        assertEq(arena.getSession(ID, alice).id, 0);
    }

    function test_settle_skipsFinalized() public {
        (ElymumArena a, BlockingToken blk) = _blockingArena();
        vm.prank(alice);
        a.join(ID);
        uint64 sid = a.getSession(ID, alice).id;
        blk.setBlocked(alice, true);
        vm.prank(server);
        a.settle(_one(ID, alice, sid, 500 ether));
        vm.expectEmit(address(a));
        emit SettleSkipped(ID, alice, sid, 3);
        vm.prank(server);
        a.settle(_one(ID, alice, sid, 500 ether));
    }

    function test_settle_replayIsSkipped() public {
        uint64 sid = _join(alice);
        _join(bob);
        ElymumArena.Settlement[] memory items = new ElymumArena.Settlement[](2);
        items[0] = ElymumArena.Settlement(ID, alice, sid, FEE);
        items[1] = ElymumArena.Settlement(ID, alice, sid, FEE); // duplicate inside the batch
        uint256 a0 = token.balanceOf(alice);
        vm.expectEmit(address(arena));
        emit Settled(ID, alice, sid, FEE, 0, true);
        vm.expectEmit(address(arena));
        emit SettleSkipped(ID, alice, sid, 2);
        _settle(items);
        assertEq(token.balanceOf(alice) - a0, FEE);

        // Replaying in a later batch, and after the player re-joined, still cannot pay the old ticket.
        _settle(_one(ID, alice, sid, FEE));
        uint64 sid2 = _join(alice);
        assertGt(sid2, sid);
        vm.expectEmit(address(arena));
        emit SettleSkipped(ID, alice, sid, 2);
        _settle(_one(ID, alice, sid, FEE));
        assertEq(arena.getSession(ID, alice).id, sid2);
    }

    function test_settle_emptyBatch() public {
        _settle(new ElymumArena.Settlement[](0));
    }

    function test_settle_failingFeeTransferRevertsBatch() public {
        (ElymumArena a, BlockingToken blk) = _blockingArena();
        vm.prank(alice);
        a.join(ID);
        vm.prank(bob);
        a.join(ID);
        blk.setBlocked(feeWallet, true);
        ElymumArena.Settlement[] memory items = new ElymumArena.Settlement[](2);
        items[0] = ElymumArena.Settlement(ID, bob, a.getSession(ID, bob).id, 100 ether); // no fee: fine alone
        items[1] = ElymumArena.Settlement(ID, alice, a.getSession(ID, alice).id, 1_500 ether); // fee leg fails
        vm.prank(server);
        vm.expectRevert("blocked");
        a.settle(items);
        assertEq(a.getSession(ID, bob).id, 2); // nothing happened
    }

    function test_settle_twoPhase_revertingPlayer() public {
        _twoPhase(1);
    }

    function test_settle_twoPhase_falseReturningPlayer() public {
        _twoPhase(2);
    }

    function _twoPhase(uint8 mode) internal {
        (ElymumArena a, BlockingToken blk) = _blockingArena();
        blk.setMode(mode);
        vm.prank(alice);
        a.join(ID);
        vm.prank(bob);
        a.join(ID);
        vm.prank(carol);
        a.join(ID);
        uint64 sa = a.getSession(ID, alice).id;
        uint64 sb = a.getSession(ID, bob).id;
        blk.setBlocked(alice, true);

        ElymumArena.Settlement[] memory items = new ElymumArena.Settlement[](2);
        items[0] = ElymumArena.Settlement(ID, alice, sa, 2 * FEE); // fee 50, owed 1950
        items[1] = ElymumArena.Settlement(ID, bob, sb, 500 ether); // the batch is not griefed
        uint256 b0 = blk.balanceOf(bob);
        vm.expectEmit(address(a));
        emit Settled(ID, alice, sa, 2 * FEE, 50 ether, false);
        vm.prank(server);
        a.settle(items);
        assertEq(blk.balanceOf(bob) - b0, 500 ether);
        assertEq(blk.balanceOf(feeWallet), 50 ether);

        ElymumArena.SessionView memory s = a.getSession(ID, alice);
        assertEq(s.id, sa);
        assertTrue(s.finalized);
        assertEq(s.owed, 1_950 ether);
        assertEq(s.entryFee, FEE);
        assertEq(s.feeBps, 500);
        ElymumArena.ArenaView memory v = a.getArena(ID);
        assertEq(v.owed, 1_950 ether);
        assertEq(v.vault, 3 * FEE - 2 * FEE - 500 ether);
        assertEq(v.openSessions, 1); // only carol
        assertEq(blk.balanceOf(address(a)), uint256(v.vault) + v.owed);

        // A finalized player cannot open a second ticket before collecting.
        vm.prank(alice);
        vm.expectRevert(ElymumArena.SessionExists.selector);
        a.join(ID);

        // Collect while still blocked reverts (and keeps the claim).
        vm.prank(alice);
        if (mode == 1) vm.expectRevert("blocked");
        else vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(blk)));
        a.refund(ID);

        // Collect needs no waiting time once unblocked.
        blk.setBlocked(alice, false);
        uint256 a0 = blk.balanceOf(alice);
        vm.expectEmit(address(a));
        emit Collected(ID, alice, sa, 1_950 ether);
        vm.prank(alice);
        a.refund(ID);
        assertEq(blk.balanceOf(alice) - a0, 1_950 ether);
        assertEq(a.getArena(ID).owed, 0);
        assertEq(a.getSession(ID, alice).id, 0);
        // The owed amount was never spendable by others.
        assertEq(blk.balanceOf(address(a)), a.getArena(ID).vault);
    }

    /// Regression: the share reserved for a finalized player is never spendable by other settlements,
    /// loot sweeps or refunds.
    function test_settle_cannotSpendOwedOfAnotherPlayer() public {
        (ElymumArena a, BlockingToken blk) = _blockingArena();
        vm.prank(alice);
        a.join(ID);
        vm.prank(bob);
        a.join(ID);
        vm.prank(carol);
        a.join(ID);
        blk.setBlocked(alice, true);
        ElymumArena.Settlement[] memory items = _one(ID, alice, a.getSession(ID, alice).id, 2 * FEE);
        vm.prank(server);
        a.settle(items); // owed 1950, vault 1000
        assertEq(a.getArena(ID).vault, FEE);
        uint64 sb = a.getSession(ID, bob).id;
        items = _one(ID, bob, sb, FEE + 1);
        vm.expectEmit(address(a));
        emit SettleSkipped(ID, bob, sb, 4);
        vm.prank(server);
        a.settle(items);
        vm.prank(server);
        vm.expectRevert(ElymumArena.InsufficientVault.selector);
        a.sweepLoot(ID, 1, FEE + 1);
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        a.refund(ID); // takes the whole vault (1000), not the owed amount
        vm.prank(carol);
        a.refund(ID); // vault is empty: 0
        assertEq(blk.balanceOf(address(a)), 1_950 ether);
        assertEq(a.getArena(ID).owed, 1_950 ether);
    }

    /// Regression: lowering capacity below the open count blocks joins but never strands open tickets.
    function test_capacityBelowOpenCount() public {
        uint64 sa = _join(alice);
        uint64 sb = _join(bob);
        _join(carol);
        vm.prank(admin);
        arena.updateArena(ID, FEE, 2, true); // 3 open > 2
        _settle(_one(ID, alice, sa, FEE));
        vm.prank(alice);
        vm.expectRevert(ElymumArena.ArenaFull.selector);
        arena.join(ID); // 2 open, still full
        _settle(_one(ID, bob, sb, FEE));
        _join(alice);
        assertEq(arena.getArena(ID).openSessions, 2);
    }

    // ---------------------------------------------------------------- refund

    function test_refund_after24h() public {
        uint64 sid = _join(alice);
        vm.prank(alice);
        vm.expectRevert(ElymumArena.RefundTooEarly.selector);
        arena.refund(ID);
        vm.warp(block.timestamp + 1 days - 1);
        vm.prank(alice);
        vm.expectRevert(ElymumArena.RefundTooEarly.selector);
        arena.refund(ID);
        vm.warp(block.timestamp + 1);
        uint256 a0 = token.balanceOf(alice);
        vm.expectEmit(address(arena));
        emit Refunded(ID, alice, sid, FEE);
        vm.prank(alice);
        arena.refund(ID);
        assertEq(token.balanceOf(alice) - a0, FEE);
        assertEq(arena.getArena(ID).openSessions, 0);
        assertEq(arena.getArena(ID).vault, 0);
        assertEq(arena.getSession(ID, alice).id, 0);
        // The ticket is gone: a late settlement is skipped, and the player can join again.
        vm.expectEmit(address(arena));
        emit SettleSkipped(ID, alice, sid, 2);
        _settle(_one(ID, alice, sid, FEE));
        _join(alice);
    }

    function test_refund_cappedByVault() public {
        uint64 sa = _join(alice);
        _join(bob);
        _settle(_one(ID, alice, sa, 1_700 ether)); // vault left: 300
        vm.warp(block.timestamp + 1 days);
        uint256 b0 = token.balanceOf(bob);
        vm.prank(bob);
        arena.refund(ID);
        assertEq(token.balanceOf(bob) - b0, 300 ether);
        assertEq(arena.getArena(ID).vault, 0);
    }

    function test_refund_noSession() public {
        vm.prank(alice);
        vm.expectRevert(ElymumArena.NoSession.selector);
        arena.refund(ID);
        vm.prank(alice);
        vm.expectRevert(ElymumArena.NoSession.selector);
        arena.refund(99);
    }

    function test_refund_racesWithSettle() public {
        uint64 sid = _join(alice);
        vm.warp(block.timestamp + 1 days);
        // The server wins the race: the refund finds nothing.
        _settle(_one(ID, alice, sid, FEE));
        vm.prank(alice);
        vm.expectRevert(ElymumArena.NoSession.selector);
        arena.refund(ID);
        // The player wins the race: the settlement is skipped.
        uint64 sid2 = _join(alice);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        arena.refund(ID);
        vm.expectEmit(address(arena));
        emit SettleSkipped(ID, alice, sid2, 2);
        _settle(_one(ID, alice, sid2, FEE));
    }

    // ---------------------------------------------------------------- sweepLoot

    function test_sweepLoot_burnsWithMonotonicIds() public {
        _join(alice);
        _join(bob);
        vm.expectEmit(address(arena));
        emit LootBurned(ID, 5, 300 ether);
        vm.prank(server);
        arena.sweepLoot(ID, 5, 300 ether);
        assertEq(token.balanceOf(DEAD), 300 ether);
        ElymumArena.ArenaView memory v = arena.getArena(ID);
        assertEq(v.vault, 2 * FEE - 300 ether);
        assertEq(v.lastSweepId, 5);
        assertEq(v.totalBurned, 300 ether);
        assertEq(arena.config().totalBurned, 300 ether);

        vm.startPrank(server);
        vm.expectRevert(ElymumArena.SweepIdNotIncreasing.selector);
        arena.sweepLoot(ID, 5, 1); // replay
        vm.expectRevert(ElymumArena.SweepIdNotIncreasing.selector);
        arena.sweepLoot(ID, 4, 1);
        vm.expectRevert(ElymumArena.InsufficientVault.selector);
        arena.sweepLoot(ID, 6, 2 * FEE);
        vm.expectRevert(ElymumArena.UnknownArena.selector);
        arena.sweepLoot(3, 1, 0);
        arena.sweepLoot(ID, 6, 0); // zero still advances the id
        vm.stopPrank();
        assertEq(arena.getArena(ID).lastSweepId, 6);

        vm.prank(admin);
        vm.expectRevert(ElymumArena.NotServer.selector);
        arena.sweepLoot(ID, 7, 1);
    }

    function test_sweepLoot_idsArePerArena() public {
        vm.prank(admin);
        arena.createArena(2, FEE, 300);
        vm.startPrank(server);
        arena.sweepLoot(ID, 10, 0);
        arena.sweepLoot(2, 1, 0);
        vm.stopPrank();
        assertEq(arena.getArena(ID).lastSweepId, 10);
        assertEq(arena.getArena(2).lastSweepId, 1);
    }

    // ---------------------------------------------------------------- views

    function test_views_emptyRecords() public view {
        ElymumArena.SessionView memory s = arena.getSession(ID, stranger);
        assertEq(s.id, 0);
        ElymumArena.ArenaView memory v = arena.getArena(77);
        assertFalse(v.exists);
        assertEq(v.id, 77);
        assertEq(arena.BURN_ADDRESS(), DEAD);
        assertEq(arena.computeFee(2_000, 1_000, 500), 50);
        assertEq(arena.computeFee(1_199, 1_000, 500), 9);
        assertEq(arena.computeFee(119, 100, 500), 0);
        assertEq(arena.computeFee(50, 100, 1_000), 0);
    }

    // ---------------------------------------------------------------- reentrancy

    function test_reentrancy_tokenCallbackIsBlocked() public {
        ReentrantToken re = new ReentrantToken();
        ElymumArena a = new ElymumArena(admin, server, feeWallet);
        vm.startPrank(admin);
        a.setToken(address(re));
        a.createArena(ID, FEE, 300);
        vm.stopPrank();
        re.mint(alice, 10 * FEE);
        vm.prank(alice);
        re.approve(address(a), type(uint256).max);
        vm.prank(alice);
        a.join(ID);
        // The token re-enters `join` during the payout transfer (as itself, a fresh player).
        re.mint(address(re), 10 * FEE);
        vm.prank(address(re));
        re.approve(address(a), type(uint256).max);
        re.arm(address(a), abi.encodeCall(ElymumArena.join, (ID)));
        vm.prank(server);
        a.settle(_one(ID, alice, 1, FEE));
        assertFalse(re.lastCallOk());
        assertEq(bytes4(re.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(a.getSession(ID, address(re)).id, 0);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_feeMath(uint128 payout, uint128 entryFee, uint16 bps) public view {
        bps = uint16(bound(bps, 0, 1_000));
        uint128 fee = arena.computeFee(payout, entryFee, bps);
        uint256 profit = payout > entryFee ? payout - entryFee : 0;
        assertEq(fee, (profit * bps) / 10_000);
        assertLe(fee, profit / 10);
        assertLe(fee, payout);
        assertEq(uint256(payout - fee) + fee, payout);
    }

    function testFuzz_settleConservation(uint128[6] memory payouts, uint16 bps, uint8 blockMask) public {
        (ElymumArena a, BlockingToken blk) = _blockingArena();
        vm.prank(admin);
        a.setFeeBps(uint16(bound(bps, 0, 1_000)));
        address[6] memory players;
        uint256 supply = blk.totalSupply();
        for (uint256 i; i < 6; ++i) {
            players[i] = address(uint160(0x1000 + i));
            blk.mint(players[i], FEE);
            vm.prank(players[i]);
            blk.approve(address(a), FEE);
            vm.prank(players[i]);
            a.join(ID);
            if (blockMask & (1 << i) != 0) blk.setBlocked(players[i], true);
        }
        supply = blk.totalSupply();

        ElymumArena.Settlement[] memory items = new ElymumArena.Settlement[](6);
        for (uint256 i; i < 6; ++i) {
            items[i] = ElymumArena.Settlement(
                ID, players[i], a.getSession(ID, players[i]).id, uint128(bound(payouts[i], 0, 4 * FEE))
            );
        }
        vm.prank(server);
        a.settle(items);
        uint128 loot = a.getArena(ID).vault / 3;
        vm.prank(server);
        a.sweepLoot(ID, 1, loot);

        ElymumArena.ArenaView memory v = a.getArena(ID);
        // Internal accounting equals the real balance.
        assertEq(blk.balanceOf(address(a)), uint256(v.vault) + v.owed);
        // Nothing is created or lost.
        uint256 total = blk.balanceOf(address(a)) + blk.balanceOf(feeWallet) + blk.balanceOf(DEAD);
        uint256 owedSum;
        for (uint256 i; i < 6; ++i) {
            total += blk.balanceOf(players[i]);
            owedSum += a.getSession(ID, players[i]).owed;
        }
        total += blk.balanceOf(alice) + blk.balanceOf(bob) + blk.balanceOf(carol);
        assertEq(total, supply);
        assertEq(owedSum, v.owed);
        assertEq(v.totalDeposited, 6 * uint256(FEE));
        assertEq(uint256(v.vault) + v.totalPaidOut + v.totalBurned, v.totalDeposited);
    }

    function testFuzz_refundNeverExceedsVault(uint128 first) public {
        uint64 sa = _join(alice);
        _join(bob);
        first = uint128(bound(first, 0, 2 * FEE));
        _settle(_one(ID, alice, sa, first));
        vm.warp(block.timestamp + 1 days);
        uint128 vault = arena.getArena(ID).vault;
        uint256 b0 = token.balanceOf(bob);
        vm.prank(bob);
        arena.refund(ID);
        uint256 got = token.balanceOf(bob) - b0;
        assertEq(got, vault < FEE ? vault : FEE);
        assertEq(token.balanceOf(address(arena)), arena.getArena(ID).vault);
    }

    // ---------------------------------------------------------------- gas

    function test_gas_join_settle1_settle40() public {
        _join(alice); // warm the arena slot like a live server would see it
        address p = makeAddr("gas-player");
        _fund(p);
        vm.prank(p);
        uint256 g = gasleft();
        arena.join(ID);
        emit log_named_uint("gas join", g - gasleft());

        ElymumArena.Settlement[] memory one = _one(ID, p, arena.getSession(ID, p).id, 1_500 ether);
        vm.prank(server);
        g = gasleft();
        arena.settle(one);
        emit log_named_uint("gas settle(1)", g - gasleft());

        vm.prank(admin);
        arena.updateArena(ID, FEE, 2_000, true);
        ElymumArena.Settlement[] memory many = new ElymumArena.Settlement[](40);
        for (uint256 i; i < 40; ++i) {
            address q = address(uint160(0x5000 + i));
            _fund(q);
            vm.prank(q);
            arena.join(ID);
            many[i] = ElymumArena.Settlement(ID, q, arena.getSession(ID, q).id, uint128(500 ether + i * 30 ether));
        }
        vm.prank(server);
        g = gasleft();
        arena.settle(many);
        uint256 used = g - gasleft();
        emit log_named_uint("gas settle(40)", used);
        assertLt(used, 3_000_000);
    }

    // ---------------------------------------------------------------- fixtures

    function _blockingArena() internal returns (ElymumArena a, BlockingToken blk) {
        blk = new BlockingToken();
        a = new ElymumArena(admin, server, feeWallet);
        vm.startPrank(admin);
        a.setToken(address(blk));
        a.createArena(ID, FEE, 300);
        vm.stopPrank();
        address[3] memory ps = [alice, bob, carol];
        for (uint256 i; i < 3; ++i) {
            blk.mint(ps[i], 10 * FEE);
            vm.prank(ps[i]);
            blk.approve(address(a), type(uint256).max);
        }
    }
}
