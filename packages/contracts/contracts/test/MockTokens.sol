// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only: plain mintable ERC-20 with configurable decimals.
contract MockERC20 is ERC20 {
    uint8 private _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Test-only: takes `feeBps` of every transfer (burned), like a fee-on-transfer token.
contract FeeOnTransferToken is ERC20 {
    uint256 public feeBps = 100;

    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && feeBps != 0) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// @notice Test-only: transfers to a blocked address revert (mode 1) or return false (mode 2), like a blocklist.
contract BlockingToken is ERC20 {
    mapping(address => bool) public blocked;
    uint8 public mode = 1;

    constructor() ERC20("Blocking Token", "BLK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (blocked[to]) {
            if (mode == 2) return false;
            revert("blocked");
        }
        return super.transfer(to, value);
    }
}

/// @notice Test-only: a token without `decimals()`.
contract NoDecimalsToken {
    function totalSupply() external pure returns (uint256) {
        return 0;
    }
}

/// @notice Test-only: on every `transfer`, calls `target` with `data` once (re-entrancy probe) and records the result.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public data;
    bool public armed;
    bool public lastCallOk;
    bytes public lastRevert;

    constructor() ERC20("Reentrant Token", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata data_) external {
        target = target_;
        data = data_;
        armed = true;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (armed) {
            armed = false;
            (bool ok, bytes memory ret) = target.call(data);
            lastCallOk = ok;
            lastRevert = ret;
        }
        return super.transfer(to, value);
    }
}
