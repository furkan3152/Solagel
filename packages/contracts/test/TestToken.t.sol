// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TestToken} from "../contracts/TestToken.sol";
import {MockNFT, BrokenNFT} from "../contracts/test/MockTokens.sol";

contract TestTokenTest is Test {
    TestToken internal t;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal minter = makeAddr("minter");

    event MinterSet(address indexed minter, bool allowed);
    event HolderNftSet(address indexed nft);
    event FaucetSet(uint256 amount, uint256 holderAmount, uint64 cooldown);
    event FaucetClaimed(address indexed to, uint256 amount, bool holder);

    function setUp() public {
        vm.warp(1_800_000_000);
        t = new TestToken(owner);
    }

    function test_metadata() public view {
        assertEq(t.name(), "Elymum Test Token");
        assertEq(t.symbol(), "tELYMUM");
        assertEq(t.decimals(), 18);
        assertEq(t.owner(), owner);
        assertEq(t.FAUCET_AMOUNT(), 1_000_000 ether);
    }

    function test_faucet_cooldown() public {
        vm.prank(alice);
        t.faucet();
        assertEq(t.balanceOf(alice), 1_000_000 ether);
        assertEq(t.lastFaucetAt(alice), block.timestamp);

        vm.warp(block.timestamp + 1 hours - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestToken.FaucetCooldown.selector, block.timestamp + 1));
        t.faucet();

        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        t.faucet();
        assertEq(t.balanceOf(alice), 2_000_000 ether);

        // Cooldown is per address.
        vm.prank(owner);
        t.faucet();
        assertEq(t.balanceOf(owner), 1_000_000 ether);
    }

    function test_mint_onlyOwner() public {
        vm.prank(owner);
        t.mint(alice, 5);
        assertEq(t.balanceOf(alice), 5);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        t.mint(alice, 5);
    }

    function _unauthorized(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    function test_defaults() public view {
        assertEq(t.faucetAmount(), 1_000_000 ether);
        assertEq(t.holderFaucetAmount(), 2_000_000 ether);
        assertEq(t.HOLDER_FAUCET_AMOUNT(), 2_000_000 ether);
        assertEq(t.faucetCooldown(), 1 hours);
        assertEq(t.holderNft(), address(0));
        assertFalse(t.isMinter(minter));
        (uint256 amount, uint256 next) = t.faucetInfo(alice);
        assertEq(amount, 1_000_000 ether);
        assertEq(next, 0);
    }

    function test_minters() public {
        vm.prank(minter);
        vm.expectRevert(_unauthorized(minter));
        t.mint(alice, 1);

        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        t.setMinter(minter, true);

        vm.expectEmit(address(t));
        emit MinterSet(minter, true);
        vm.prank(owner);
        t.setMinter(minter, true);
        assertTrue(t.isMinter(minter));
        vm.prank(minter);
        t.mint(alice, 7 ether);
        assertEq(t.balanceOf(alice), 7 ether);

        vm.prank(owner);
        t.setMinter(minter, false);
        vm.prank(minter);
        vm.expectRevert(_unauthorized(minter));
        t.mint(alice, 1);
        // The owner can always mint.
        vm.prank(owner);
        t.mint(bob, 1);
        assertEq(t.balanceOf(bob), 1);
    }

    function test_faucet_holderGetsDouble() public {
        MockNFT nft = new MockNFT();
        nft.setBalance(alice, 1);
        vm.expectEmit(address(t));
        emit HolderNftSet(address(nft));
        vm.prank(owner);
        t.setHolderNft(address(nft));

        (uint256 a,) = t.faucetInfo(alice);
        (uint256 b,) = t.faucetInfo(bob);
        assertEq(a, 2_000_000 ether);
        assertEq(b, 1_000_000 ether);

        vm.expectEmit(address(t));
        emit FaucetClaimed(alice, 2_000_000 ether, true);
        vm.prank(alice);
        t.faucet();
        vm.expectEmit(address(t));
        emit FaucetClaimed(bob, 1_000_000 ether, false);
        vm.prank(bob);
        t.faucet();
        assertEq(t.balanceOf(alice), 2_000_000 ether);
        assertEq(t.balanceOf(bob), 1_000_000 ether);

        (, uint256 next) = t.faucetInfo(alice);
        assertEq(next, block.timestamp + 1 hours);
    }

    function test_faucet_brokenNftGivesNormalAmount() public {
        BrokenNFT nft = new BrokenNFT();
        vm.prank(owner);
        t.setHolderNft(address(nft));
        address[6] memory ps =
            [makeAddr("b1"), makeAddr("b2"), makeAddr("b3"), makeAddr("b4"), makeAddr("b5"), makeAddr("b6")];
        for (uint8 m = 1; m <= 6; ++m) {
            nft.setMode(m);
            (uint256 amount,) = t.faucetInfo(ps[m - 1]);
            assertEq(amount, 1_000_000 ether);
            vm.prank(ps[m - 1]);
            t.faucet();
            assertEq(t.balanceOf(ps[m - 1]), 1_000_000 ether);
        }
    }

    function test_setHolderNft_reverts() public {
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        t.setHolderNft(address(0));
        vm.prank(owner);
        vm.expectRevert(TestToken.NotAContract.selector);
        t.setHolderNft(alice);
        vm.prank(owner);
        t.setHolderNft(address(0));
    }

    function test_setFaucet_amountsAndCooldown() public {
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        t.setFaucet(1, 2, 3);

        vm.startPrank(owner);
        vm.expectRevert(TestToken.InvalidFaucet.selector);
        t.setFaucet(0, 1, 60);
        vm.expectRevert(TestToken.InvalidFaucet.selector);
        t.setFaucet(10, 9, 60);
        vm.expectEmit(address(t));
        emit FaucetSet(5 ether, 10 ether, 10 minutes);
        t.setFaucet(5 ether, 10 ether, 10 minutes);
        vm.stopPrank();

        vm.prank(alice);
        t.faucet();
        assertEq(t.balanceOf(alice), 5 ether);
        (uint256 amount, uint256 next) = t.faucetInfo(alice);
        assertEq(amount, 5 ether);
        assertEq(next, block.timestamp + 10 minutes);

        vm.warp(block.timestamp + 10 minutes - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestToken.FaucetCooldown.selector, block.timestamp + 1));
        t.faucet();
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        t.faucet();
        assertEq(t.balanceOf(alice), 10 ether);

        // Cooldown 0: claim as often as you like.
        vm.prank(owner);
        t.setFaucet(1 ether, 1 ether, 0);
        vm.prank(alice);
        t.faucet();
        vm.prank(alice);
        t.faucet();
        assertEq(t.balanceOf(alice), 12 ether);
    }
}
