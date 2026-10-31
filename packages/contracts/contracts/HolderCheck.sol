// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title HolderCheck
/// @notice Asks an ERC-721 whether an address holds at least one token, without ever reverting.
/// @dev    Internal library (inlined, no linking). Equivalent to
///         `try IERC721(nft).balanceOf(who) returns (uint256 b) { return b > 0; } catch { return false; }`, but also
///         safe against the cases a Solidity `try` does not catch: an address without code, short or malformed
///         return data, a return-data bomb, and a call that burns all the gas (the call gets at most `GAS`).
library HolderCheck {
    /// @dev Gas forwarded to `balanceOf`: a plain ERC-721 needs ~5k (one cold SLOAD).
    uint256 internal constant GAS = 50_000;

    /// @return true when `nft` is set, answers `balanceOf(who)` with at least 32 bytes and the value is non-zero.
    function isHolder(address nft, address who) internal view returns (bool) {
        if (nft == address(0) || nft.code.length == 0) return false;
        bytes4 selector = 0x70a08231; // balanceOf(address)
        bool ok;
        uint256 size;
        uint256 bal;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            mstore(add(ptr, 0x04), and(who, 0xffffffffffffffffffffffffffffffffffffffff))
            // Copies at most 32 bytes of return data into scratch space, whatever the callee returns.
            ok := staticcall(GAS, nft, ptr, 0x24, 0x00, 0x20)
            size := returndatasize()
            bal := mload(0x00)
        }
        return ok && size >= 0x20 && bal != 0;
    }
}
