// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TestToken} from "../contracts/TestToken.sol";

contract TestTokenTest is Test {
    TestToken internal t;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");

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
}
