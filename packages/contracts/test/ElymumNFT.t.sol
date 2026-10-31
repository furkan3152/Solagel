// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ElymumNFT} from "../contracts/ElymumNFT.sol";
import {RejectEther, ReentrantMinter, IElymumNFTMint} from "../contracts/test/Actors.sol";

/// @dev Builds an OpenZeppelin-compatible Merkle tree (double-hashed `abi.encode(address)` leaves, sorted-pair
///      hashing) in the test, the same scheme the server uses.
contract MerkleHelper {
    function leaf(address a) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a))));
    }

    function hashPair(bytes32 a, bytes32 b) public pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// @return root the tree root
    /// @return proof the proof for `leaves[index]`
    function build(bytes32[] memory leaves, uint256 index)
        public
        pure
        returns (bytes32 root, bytes32[] memory proof)
    {
        bytes32[] memory level = leaves;
        bytes32[] memory tmp = new bytes32[](64);
        uint256 depth;
        uint256 idx = index;
        while (level.length > 1) {
            uint256 sibling = idx ^ 1;
            if (sibling < level.length) tmp[depth++] = level[sibling];
            bytes32[] memory next = new bytes32[]((level.length + 1) / 2);
            for (uint256 i; i < next.length; ++i) {
                uint256 l = 2 * i;
                next[i] = l + 1 < level.length ? hashPair(level[l], level[l + 1]) : level[l];
            }
            level = next;
            idx /= 2;
        }
        root = level[0];
        proof = new bytes32[](depth);
        for (uint256 i; i < depth; ++i) {
            proof[i] = tmp[i];
        }
    }
}

contract ElymumNFTTest is Test, MerkleHelper {
    ElymumNFT internal nft;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal mallory = makeAddr("mallory");

    uint256 internal constant PRICE = 0.03 ether;
    address[] internal wl;

    event PhaseSet(ElymumNFT.Phase phase);
    event MerkleRootSet(bytes32 root);
    event PriceSet(uint256 price, address indexed by);
    event Minted(address indexed to, uint256 firstId, uint256 qty, ElymumNFT.Phase phase, uint256 paid);
    event Withdrawn(address indexed treasury, uint256 amount);
    event MetadataFrozen();
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    event ContractURIUpdated();

    function setUp() public {
        nft = new ElymumNFT(owner, 100, PRICE, 2, 3, "https://elymum.test/api/nft/", treasury);
        wl.push(alice);
        wl.push(bob);
        wl.push(carol);
        for (uint160 i = 1; i <= 7; ++i) {
            wl.push(address(i * 0x1111));
        }
        vm.prank(owner);
        nft.setMerkleRoot(_root());
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(mallory, 100 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _leaves() internal view returns (bytes32[] memory l) {
        l = new bytes32[](wl.length);
        for (uint256 i; i < wl.length; ++i) {
            l[i] = leaf(wl[i]);
        }
    }

    function _root() internal view returns (bytes32 root) {
        (root,) = build(_leaves(), 0);
    }

    function _proof(address who) internal view returns (bytes32[] memory proof) {
        for (uint256 i; i < wl.length; ++i) {
            if (wl[i] == who) {
                (, proof) = build(_leaves(), i);
                return proof;
            }
        }
        revert("not listed");
    }

    function _phase(ElymumNFT.Phase p) internal {
        vm.prank(owner);
        nft.setPhase(p);
    }

    function _unauthorized(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    // ---------------------------------------------------------------- constructor & views

    function test_constructor() public view {
        assertEq(nft.name(), "Elymum");
        assertEq(nft.symbol(), "ELYMUM");
        assertEq(nft.owner(), owner);
        ElymumNFT.MintStateView memory s = nft.mintState();
        assertEq(uint8(s.phase), uint8(ElymumNFT.Phase.Closed));
        assertEq(s.price, PRICE);
        assertEq(s.minPrice, 0);
        assertEq(s.maxPrice, 0);
        assertEq(s.keeper, address(0));
        assertEq(s.root, _root());
        assertEq(s.maxSupply, 100);
        assertEq(s.totalSupply, 0);
        assertEq(s.wlLimit, 2);
        assertEq(s.publicLimit, 3);
        assertEq(s.treasury, treasury);
        assertFalse(s.frozen);
        assertEq(nft.totalSupply(), 0);
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(ElymumNFT.ZeroAddress.selector);
        new ElymumNFT(owner, 100, PRICE, 2, 3, "", address(0));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ElymumNFT(address(0), 100, PRICE, 2, 3, "", treasury);
    }

    function test_supportsInterface() public view {
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC-721
        assertTrue(nft.supportsInterface(0x5b5e139f)); // metadata
        assertTrue(nft.supportsInterface(0x2a55205a)); // ERC-2981
        assertTrue(nft.supportsInterface(0x49064906)); // ERC-4906
        assertTrue(nft.supportsInterface(0x01ffc9a7)); // ERC-165
        assertFalse(nft.supportsInterface(0xffffffff));
    }

    // ---------------------------------------------------------------- phases

    function test_closed_blocksBothMints() public {
        bytes32[] memory p = _proof(alice);
        vm.prank(alice);
        vm.expectRevert(ElymumNFT.MintClosed.selector);
        nft.mintAllowlist{value: PRICE}(1, p);
        vm.prank(alice);
        vm.expectRevert(ElymumNFT.MintClosed.selector);
        nft.mintPublic{value: PRICE}(1);
    }

    function test_allowlistPhase() public {
        vm.expectEmit(address(nft));
        emit PhaseSet(ElymumNFT.Phase.Allowlist);
        _phase(ElymumNFT.Phase.Allowlist);
        bytes32[] memory p = _proof(alice);
        vm.expectEmit(address(nft));
        emit Minted(alice, 1, 2, ElymumNFT.Phase.Allowlist, 2 * PRICE);
        vm.prank(alice);
        nft.mintAllowlist{value: 2 * PRICE}(2, p);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.ownerOf(2), alice);
        assertEq(nft.balanceOf(alice), 2);
        (uint16 w, uint16 pub) = nft.mintedBy(alice);
        assertEq(w, 2);
        assertEq(pub, 0);
        assertEq(address(nft).balance, 2 * PRICE);

        // Public mint is still closed.
        vm.prank(alice);
        vm.expectRevert(ElymumNFT.MintClosed.selector);
        nft.mintPublic{value: PRICE}(1);
    }

    function test_publicPhase_allowsBoth_withSeparateLimits() public {
        _phase(ElymumNFT.Phase.Public);
        bytes32[] memory p = _proof(bob);
        vm.startPrank(bob);
        nft.mintAllowlist{value: 2 * PRICE}(2, p);
        nft.mintPublic{value: 3 * PRICE}(3);
        vm.expectRevert(ElymumNFT.WlLimitExceeded.selector);
        nft.mintAllowlist{value: PRICE}(1, p);
        vm.expectRevert(ElymumNFT.PublicLimitExceeded.selector);
        nft.mintPublic{value: PRICE}(1);
        vm.stopPrank();
        (uint16 w, uint16 pub) = nft.mintedBy(bob);
        assertEq(w, 2);
        assertEq(pub, 3);
        assertEq(nft.balanceOf(bob), 5);
        // Anyone can mint in public.
        vm.prank(mallory);
        nft.mintPublic{value: PRICE}(1);
        assertEq(nft.ownerOf(6), mallory);
    }

    function test_renounceOwnership_disabled() public {
        vm.prank(owner);
        vm.expectRevert(ElymumNFT.RenounceDisabled.selector);
        nft.renounceOwnership();
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.renounceOwnership();
        assertEq(nft.owner(), owner);
    }

    function test_setPhase_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.setPhase(ElymumNFT.Phase.Public);
    }

    // ---------------------------------------------------------------- allowlist proofs

    function test_allowlist_everyListedWalletVerifies() public {
        _phase(ElymumNFT.Phase.Allowlist);
        for (uint256 i; i < wl.length; ++i) {
            vm.deal(wl[i], 1 ether);
            bytes32[] memory p = _proof(wl[i]);
            vm.prank(wl[i]);
            nft.mintAllowlist{value: PRICE}(1, p);
        }
        assertEq(nft.totalSupply(), wl.length);
    }

    function test_allowlist_rejectsUnlistedAndStolenProofs() public {
        _phase(ElymumNFT.Phase.Allowlist);
        bytes32[] memory p = _proof(alice);
        // Mallory reuses Alice's proof: the leaf is bound to msg.sender.
        vm.prank(mallory);
        vm.expectRevert(ElymumNFT.NotAllowlisted.selector);
        nft.mintAllowlist{value: PRICE}(1, p);
        // Empty proof.
        vm.prank(mallory);
        vm.expectRevert(ElymumNFT.NotAllowlisted.selector);
        nft.mintAllowlist{value: PRICE}(1, new bytes32[](0));
        // A wrong root rejects everyone.
        vm.prank(owner);
        nft.setMerkleRoot(bytes32(uint256(1)));
        vm.prank(alice);
        vm.expectRevert(ElymumNFT.NotAllowlisted.selector);
        nft.mintAllowlist{value: PRICE}(1, p);
    }

    function test_allowlist_secondPreimage_internalNodeIsNotALeaf() public {
        _phase(ElymumNFT.Phase.Allowlist);
        // An attacker shortens Alice's proof so that an internal node would be "the leaf". Because leaves are
        // double-hashed and bound to msg.sender, no caller address can produce that value: the shortened proof
        // is useless for everyone, including Alice.
        bytes32[] memory p = _proof(alice);
        bytes32[] memory shortP = new bytes32[](p.length - 1);
        for (uint256 i = 1; i < p.length; ++i) {
            shortP[i - 1] = p[i];
        }
        vm.prank(alice);
        vm.expectRevert(ElymumNFT.NotAllowlisted.selector);
        nft.mintAllowlist{value: PRICE}(1, shortP);
        // A single-hashed leaf (the classic mistake) does not verify either.
        assertTrue(keccak256(abi.encode(alice)) != leaf(alice));
    }

    function test_allowlist_singleLeafTree() public {
        vm.prank(owner);
        nft.setMerkleRoot(leaf(carol));
        _phase(ElymumNFT.Phase.Allowlist);
        vm.prank(carol);
        nft.mintAllowlist{value: PRICE}(1, new bytes32[](0));
        assertEq(nft.ownerOf(1), carol);
    }

    function test_setMerkleRoot() public {
        vm.expectEmit(address(nft));
        emit MerkleRootSet(bytes32(uint256(7)));
        vm.prank(owner);
        nft.setMerkleRoot(bytes32(uint256(7)));
        assertEq(nft.mintState().root, bytes32(uint256(7)));
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.setMerkleRoot(bytes32(0));
    }

    // ---------------------------------------------------------------- limits, payment, supply

    function test_limits_perWallet() public {
        _phase(ElymumNFT.Phase.Allowlist);
        bytes32[] memory p = _proof(alice);
        vm.startPrank(alice);
        vm.expectRevert(ElymumNFT.WlLimitExceeded.selector);
        nft.mintAllowlist{value: 3 * PRICE}(3, p);
        nft.mintAllowlist{value: PRICE}(1, p);
        nft.mintAllowlist{value: PRICE}(1, p);
        vm.expectRevert(ElymumNFT.WlLimitExceeded.selector);
        nft.mintAllowlist{value: PRICE}(1, p);
        vm.stopPrank();

        // Raising the limit lets the wallet continue.
        vm.prank(owner);
        nft.setLimits(3, 0);
        vm.prank(alice);
        nft.mintAllowlist{value: PRICE}(1, p);
        _phase(ElymumNFT.Phase.Public);
        vm.prank(bob);
        vm.expectRevert(ElymumNFT.PublicLimitExceeded.selector);
        nft.mintPublic{value: PRICE}(1);
    }

    function test_limits_hugeQuantityDoesNotWrap() public {
        _phase(ElymumNFT.Phase.Public);
        vm.prank(owner);
        nft.setLimits(type(uint16).max, type(uint16).max);
        vm.startPrank(alice);
        vm.expectRevert(ElymumNFT.PublicLimitExceeded.selector);
        nft.mintPublic{value: 0}(uint256(type(uint16).max) + 1);
        vm.expectRevert(ElymumNFT.PublicLimitExceeded.selector);
        nft.mintPublic{value: 0}(type(uint256).max);
        bytes32[] memory p = _proof(alice);
        vm.expectRevert(ElymumNFT.WlLimitExceeded.selector);
        nft.mintAllowlist{value: 0}(type(uint256).max, p);
        vm.stopPrank();
    }

    function test_setLimits() public {
        vm.prank(owner);
        nft.setLimits(5, 6);
        assertEq(nft.mintState().wlLimit, 5);
        assertEq(nft.mintState().publicLimit, 6);
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.setLimits(1, 1);
    }

    function test_zeroQuantity() public {
        _phase(ElymumNFT.Phase.Public);
        bytes32[] memory p = _proof(alice);
        vm.startPrank(alice);
        vm.expectRevert(ElymumNFT.ZeroQuantity.selector);
        nft.mintPublic(0);
        vm.expectRevert(ElymumNFT.ZeroQuantity.selector);
        nft.mintAllowlist(0, p);
        vm.stopPrank();
        vm.prank(owner);
        vm.expectRevert(ElymumNFT.ZeroQuantity.selector);
        nft.ownerMint(alice, 0);
    }

    function test_payment_insufficient() public {
        _phase(ElymumNFT.Phase.Public);
        vm.prank(alice);
        vm.expectRevert(ElymumNFT.InsufficientPayment.selector);
        nft.mintPublic{value: 2 * PRICE - 1}(2);
    }

    function test_payment_excessIsRefunded() public {
        _phase(ElymumNFT.Phase.Public);
        uint256 a0 = alice.balance;
        vm.prank(alice);
        nft.mintPublic{value: 1 ether}(2);
        assertEq(a0 - alice.balance, 2 * PRICE);
        assertEq(address(nft).balance, 2 * PRICE);

        _phase(ElymumNFT.Phase.Allowlist);
        bytes32[] memory p = _proof(bob);
        uint256 b0 = bob.balance;
        vm.prank(bob);
        nft.mintAllowlist{value: 5 ether}(1, p);
        assertEq(b0 - bob.balance, PRICE);
        assertEq(address(nft).balance, 3 * PRICE);
    }

    function test_payment_refundFailureReverts() public {
        _phase(ElymumNFT.Phase.Public);
        RejectEther rej = new RejectEther();
        vm.deal(address(rej), 1 ether);
        vm.expectRevert(ElymumNFT.RefundFailed.selector);
        rej.call{value: PRICE + 1}(address(nft), abi.encodeCall(ElymumNFT.mintPublic, (1)));
        // Exact payment needs no refund and works.
        rej.call{value: PRICE}(address(nft), abi.encodeCall(ElymumNFT.mintPublic, (1)));
        assertEq(nft.ownerOf(1), address(rej));
    }

    function test_payment_refundCannotReenter() public {
        _phase(ElymumNFT.Phase.Public);
        ReentrantMinter atk = new ReentrantMinter(IElymumNFTMint(address(nft)));
        vm.deal(address(atk), 0); // pays from msg.value only
        atk.attack{value: 3 * PRICE}(PRICE);
        assertTrue(atk.reentered());
        assertFalse(atk.reentrySucceeded());
        assertEq(nft.balanceOf(address(atk)), 1);
        (, uint16 pub) = nft.mintedBy(address(atk));
        assertEq(pub, 1);
        assertEq(address(nft).balance, PRICE);
    }

    function test_freeMintWhenPriceIsZero() public {
        vm.prank(owner);
        nft.setPrice(0);
        _phase(ElymumNFT.Phase.Public);
        vm.prank(alice);
        nft.mintPublic(1);
        assertEq(nft.ownerOf(1), alice);
    }

    function test_supply_soldOut() public {
        vm.prank(owner);
        nft.setMaxSupply(4);
        _phase(ElymumNFT.Phase.Public);
        vm.prank(alice);
        nft.mintPublic{value: 3 * PRICE}(3);
        vm.prank(bob);
        vm.expectRevert(ElymumNFT.SoldOut.selector);
        nft.mintPublic{value: 2 * PRICE}(2);
        vm.prank(bob);
        nft.mintPublic{value: PRICE}(1);
        vm.prank(owner);
        vm.expectRevert(ElymumNFT.SoldOut.selector);
        nft.ownerMint(owner, 1);
    }

    function test_setMaxSupply_onlyDown() public {
        vm.startPrank(owner);
        vm.expectRevert(ElymumNFT.MaxSupplyIncrease.selector);
        nft.setMaxSupply(101);
        nft.ownerMint(owner, 10);
        vm.expectRevert(ElymumNFT.MaxSupplyBelowTotal.selector);
        nft.setMaxSupply(9);
        nft.setMaxSupply(10);
        assertEq(nft.mintState().maxSupply, 10);
        vm.expectRevert(ElymumNFT.MaxSupplyIncrease.selector);
        nft.setMaxSupply(11);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.setMaxSupply(5);
    }

    function test_ownerMint() public {
        vm.expectEmit(address(nft));
        emit Minted(bob, 1, 5, ElymumNFT.Phase.Closed, 0);
        vm.prank(owner);
        nft.ownerMint(bob, 5);
        assertEq(nft.balanceOf(bob), 5);
        assertEq(nft.ownerOf(5), bob);
        (uint16 w, uint16 pub) = nft.mintedBy(bob);
        assertEq(w + pub, 0); // does not use the wallet's limits
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(0)));
        nft.ownerMint(address(0), 1);
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.ownerMint(alice, 1);
    }

    // ---------------------------------------------------------------- price & keeper

    function test_setPrice_owner() public {
        vm.expectEmit(address(nft));
        emit PriceSet(1 ether, owner);
        vm.prank(owner);
        nft.setPrice(1 ether);
        assertEq(nft.mintState().price, 1 ether);
    }

    function test_setPrice_strangerAndUnsetKeeper() public {
        vm.prank(alice);
        vm.expectRevert(ElymumNFT.NotPriceSetter.selector);
        nft.setPrice(1);
        // No keeper set: address(0) can never pass.
        vm.prank(address(0));
        vm.expectRevert(ElymumNFT.NotPriceSetter.selector);
        nft.setPrice(1);
    }

    function test_keeper_boundedByMinMax() public {
        vm.prank(owner);
        nft.setPriceKeeper(keeper);
        assertEq(nft.mintState().keeper, keeper);

        // Bounds not set yet: the keeper can do nothing (in particular it cannot set the price to 0).
        vm.prank(keeper);
        vm.expectRevert(ElymumNFT.PriceOutOfBounds.selector);
        nft.setPrice(0);
        vm.prank(keeper);
        vm.expectRevert(ElymumNFT.PriceOutOfBounds.selector);
        nft.setPrice(PRICE);

        vm.prank(owner);
        nft.setPriceBounds(0.02 ether, 0.05 ether);
        vm.startPrank(keeper);
        vm.expectRevert(ElymumNFT.PriceOutOfBounds.selector);
        nft.setPrice(0.02 ether - 1);
        vm.expectRevert(ElymumNFT.PriceOutOfBounds.selector);
        nft.setPrice(0.05 ether + 1);
        vm.expectRevert(ElymumNFT.PriceOutOfBounds.selector);
        nft.setPrice(0);
        nft.setPrice(0.02 ether);
        nft.setPrice(0.05 ether);
        vm.expectEmit(address(nft));
        emit PriceSet(0.04 ether, keeper);
        nft.setPrice(0.04 ether);
        vm.stopPrank();
        assertEq(nft.mintState().price, 0.04 ether);

        // The keeper cannot touch anything else.
        vm.prank(keeper);
        vm.expectRevert(_unauthorized(keeper));
        nft.setPriceBounds(1, type(uint256).max);
        vm.prank(keeper);
        vm.expectRevert(_unauthorized(keeper));
        nft.setPriceKeeper(keeper);

        // The owner is not bounded.
        vm.prank(owner);
        nft.setPrice(10 ether);
        // Removing the keeper.
        vm.prank(owner);
        nft.setPriceKeeper(address(0));
        vm.prank(keeper);
        vm.expectRevert(ElymumNFT.NotPriceSetter.selector);
        nft.setPrice(0.03 ether);
    }

    function test_setPriceBounds_validation() public {
        vm.startPrank(owner);
        vm.expectRevert(ElymumNFT.InvalidPriceBounds.selector);
        nft.setPriceBounds(0, 1 ether);
        vm.expectRevert(ElymumNFT.InvalidPriceBounds.selector);
        nft.setPriceBounds(2, 1);
        nft.setPriceBounds(1, 1);
        vm.stopPrank();
        assertEq(nft.mintState().minPrice, 1);
        assertEq(nft.mintState().maxPrice, 1);
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.setPriceBounds(1, 2);
    }

    function testFuzz_keeperNeverEscapesBounds(uint256 lo, uint256 hi, uint256 p) public {
        lo = bound(lo, 1, type(uint128).max);
        hi = bound(hi, lo, type(uint128).max);
        vm.startPrank(owner);
        nft.setPriceBounds(lo, hi);
        nft.setPriceKeeper(keeper);
        vm.stopPrank();
        vm.prank(keeper);
        if (p < lo || p > hi) {
            vm.expectRevert(ElymumNFT.PriceOutOfBounds.selector);
            nft.setPrice(p);
        } else {
            nft.setPrice(p);
            assertEq(nft.mintState().price, p);
        }
    }

    function testFuzz_paymentAndRefund(uint8 qty, uint96 extra) public {
        qty = uint8(bound(qty, 1, 3));
        _phase(ElymumNFT.Phase.Public);
        uint256 cost = PRICE * qty;
        uint256 a0 = alice.balance;
        vm.prank(alice);
        nft.mintPublic{value: cost + uint256(extra) % 10 ether}(qty);
        assertEq(a0 - alice.balance, cost);
        assertEq(address(nft).balance, cost);
        assertEq(nft.balanceOf(alice), qty);
    }

    // ---------------------------------------------------------------- metadata

    function test_tokenURI_andFreeze() public {
        vm.prank(owner);
        nft.ownerMint(alice, 12);
        assertEq(nft.tokenURI(1), "https://elymum.test/api/nft/1");
        assertEq(nft.tokenURI(12), "https://elymum.test/api/nft/12");
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 13));
        nft.tokenURI(13);

        vm.expectEmit(address(nft));
        emit BatchMetadataUpdate(1, type(uint256).max);
        vm.prank(owner);
        nft.setBaseURI("ipfs://cid/");
        assertEq(nft.tokenURI(3), "ipfs://cid/3");

        vm.expectEmit(address(nft));
        emit MetadataFrozen();
        vm.prank(owner);
        nft.freezeMetadata();
        assertTrue(nft.mintState().frozen);
        vm.startPrank(owner);
        vm.expectRevert(ElymumNFT.MetadataIsFrozen.selector);
        nft.setBaseURI("x");
        vm.expectRevert(ElymumNFT.MetadataIsFrozen.selector);
        nft.freezeMetadata();
        vm.stopPrank();
        assertEq(nft.tokenURI(3), "ipfs://cid/3");

        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.setBaseURI("x");
    }

    function test_freezeMetadata_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.freezeMetadata();
    }

    function test_contractURI() public {
        assertEq(nft.contractURI(), "");
        vm.expectEmit(address(nft));
        emit ContractURIUpdated();
        vm.prank(owner);
        nft.setContractURI("https://elymum.test/api/nft/contract");
        assertEq(nft.contractURI(), "https://elymum.test/api/nft/contract");
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.setContractURI("x");
    }

    // ---------------------------------------------------------------- treasury, withdraw, royalty

    function test_withdraw_toTreasury() public {
        _phase(ElymumNFT.Phase.Public);
        vm.prank(alice);
        nft.mintPublic{value: 3 * PRICE}(3);
        vm.expectEmit(address(nft));
        emit Withdrawn(treasury, 3 * PRICE);
        // Anyone holding the owner key triggers it, but funds only ever go to the treasury.
        vm.prank(owner);
        nft.withdraw();
        assertEq(treasury.balance, 3 * PRICE);
        assertEq(address(nft).balance, 0);
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.withdraw();
    }

    function test_withdraw_failingTreasuryReverts() public {
        RejectEther rej = new RejectEther();
        vm.prank(owner);
        nft.setTreasury(address(rej));
        vm.deal(address(nft), 1 ether);
        vm.prank(owner);
        vm.expectRevert(ElymumNFT.WithdrawFailed.selector);
        nft.withdraw();
    }

    function test_setTreasury() public {
        vm.prank(owner);
        nft.setTreasury(bob);
        assertEq(nft.mintState().treasury, bob);
        vm.prank(owner);
        vm.expectRevert(ElymumNFT.ZeroAddress.selector);
        nft.setTreasury(address(0));
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.setTreasury(alice);
    }

    function test_royalty() public {
        (address r, uint256 amt) = nft.royaltyInfo(1, 10_000);
        assertEq(r, address(0));
        assertEq(amt, 0);
        vm.prank(owner);
        nft.setRoyalty(treasury, 500);
        (r, amt) = nft.royaltyInfo(1, 10_000);
        assertEq(r, treasury);
        assertEq(amt, 500);
        vm.prank(owner);
        nft.setRoyalty(treasury, 1_000);
        vm.startPrank(owner);
        vm.expectRevert(ElymumNFT.RoyaltyTooHigh.selector);
        nft.setRoyalty(treasury, 1_001);
        vm.expectRevert(abi.encodeWithSelector(ERC2981.ERC2981InvalidDefaultRoyaltyReceiver.selector, address(0)));
        nft.setRoyalty(address(0), 100);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice));
        nft.setRoyalty(alice, 1);
    }

    // ---------------------------------------------------------------- ownership

    function test_ownable2Step() public {
        vm.prank(owner);
        nft.transferOwnership(bob);
        assertEq(nft.owner(), owner);
        assertEq(nft.pendingOwner(), bob);
        vm.prank(carol);
        vm.expectRevert(_unauthorized(carol));
        nft.acceptOwnership();
        vm.prank(bob);
        nft.acceptOwnership();
        assertEq(nft.owner(), bob);
        vm.prank(owner);
        vm.expectRevert(_unauthorized(owner));
        nft.setPhase(ElymumNFT.Phase.Public);
        // The new owner also controls pricing.
        vm.prank(bob);
        nft.setPrice(1);
    }

    function test_transfersWork() public {
        vm.prank(owner);
        nft.ownerMint(alice, 1);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        assertEq(nft.ownerOf(1), bob);
    }

    // ---------------------------------------------------------------- gas

    function test_gas_mintAllowlist() public {
        _phase(ElymumNFT.Phase.Allowlist);
        bytes32[] memory p = _proof(alice);
        vm.prank(alice);
        uint256 g = gasleft();
        nft.mintAllowlist{value: PRICE}(1, p);
        emit log_named_uint("gas mintAllowlist(1)", g - gasleft());
    }
}
