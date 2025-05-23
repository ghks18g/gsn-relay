// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "./GasFreeERC20.sol";
import "../open-gsn/forwarder/IForwarder.sol";

contract ClamCoin is GasFreeERC20 {
    constructor(address _trustedForwarder) GasFreeERC20("ClamCoin", "CLAM", _trustedForwarder) {
        super._mint(msg.sender, 1_000_000_000 * 10 ** decimals());
    }
}
