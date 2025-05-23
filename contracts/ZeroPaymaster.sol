// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "./open-gsn/BasePaymaster.sol";
import "./open-gsn/interfaces/IRelayHub.sol";

contract ZeroPaymaster is BasePaymaster {
    constructor(IRelayHub _relayHub, IForwarder _forwarder) Ownable(_msgSender()) BasePaymaster() {
        setRelayHub(_relayHub);
        setTrustedForwarder(address(_forwarder));
    }

    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
        external
        override
        returns (bytes memory context, bool rejectOnRecipientRevert)
    {}

    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) external override {}

    function versionPaymaster()
        external
        view
        override
        returns (string memory)
    {}
}