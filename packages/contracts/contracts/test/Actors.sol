// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IElymumNFTMint {
    function mintPublic(uint256 qty) external payable;
    function withdraw() external;
}

/// @notice Test-only: a contract that refuses HYPE.
contract RejectEther {
    function call(address target, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}

/// @notice Test-only: re-enters the NFT mint from the excess-payment refund.
contract ReentrantMinter {
    IElymumNFTMint public nft;
    uint256 public price;
    bool public reentered;
    bool public reentrySucceeded;

    constructor(IElymumNFTMint nft_) {
        nft = nft_;
    }

    function attack(uint256 price_) external payable {
        price = price_;
        nft.mintPublic{value: msg.value}(1);
    }

    receive() external payable {
        if (!reentered) {
            reentered = true;
            try nft.mintPublic{value: price}(1) {
                reentrySucceeded = true;
            } catch {}
        }
    }
}
