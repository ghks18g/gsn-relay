/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable not-rely-on-time */
/* solhint-disable avoid-tx-origin */
/* solhint-disable bracket-align */
// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "./utils/MinLibBytes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./utils/GsnUtils.sol";
import "./utils/GsnEip712Library.sol";
import "./utils/RelayHubValidator.sol";
import "./utils/GsnTypes.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IPaymaster.sol";
import "./forwarder/IForwarder.sol";
import "./interfaces/IStakeManager.sol";
import "hardhat/console.sol";


contract RelayHub is IRelayHub, Ownable {

    string public override versionHub = "2.2.3+opengsn.hub.irelayhub";

    IStakeManager public immutable override stakeManager;
    address public immutable override penalizer;

    RelayHubConfig private config;

    function getConfiguration() public override view returns (RelayHubConfig memory) {
        return config;
    }

    function setConfiguration(RelayHubConfig memory _config) public override onlyOwner {
        config = _config;
        emit RelayHubConfigured(config);
    }

    uint256 public constant G_NONZERO = 16;

    // maps relay worker's address to its manager's address
    mapping(address => address) public override workerToManager;

    // maps relay managers to the number of their workers
    mapping(address => uint256) public override workerCount;

    mapping(address => uint256) private balances;

    uint256 public override deprecationBlock = type(uint).max;

    constructor (
        IStakeManager _stakeManager,
        address _penalizer,
        uint256 _maxWorkerCount,
        uint256 _gasReserve,
        uint256 _postOverhead,
        uint256 _gasOverhead,
        uint256 _maximumRecipientDeposit,
        uint256 _minimumUnstakeDelay,
        uint256 _minimumStake,
        uint256 _dataGasCostPerByte,
        uint256 _externalCallDataCostOverhead
    )Ownable(_msgSender()) {
        stakeManager = _stakeManager;
        penalizer = _penalizer;
        setConfiguration(RelayHubConfig(
            _maxWorkerCount,
            _gasReserve,
            _postOverhead,
            _gasOverhead,
            _maximumRecipientDeposit,
            _minimumUnstakeDelay,
            _minimumStake,
            _dataGasCostPerByte,
            _externalCallDataCostOverhead
        ));
    }

    function registerRelayServer(uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external override {
        address relayManager = msg.sender;
        require(
            isRelayManagerStaked(relayManager),
            "relay manager not staked"
        );
        require(workerCount[relayManager] > 0, "no relay workers");
        emit RelayServerRegistered(relayManager, baseRelayFee, pctRelayFee, url);
    }

    function addRelayWorkers(address[] calldata newRelayWorkers) external override {
        address relayManager = msg.sender;
        uint256 newWorkerCount = workerCount[relayManager] + newRelayWorkers.length;
        workerCount[relayManager] = newWorkerCount;
        require(newWorkerCount <= config.maxWorkerCount, "too many workers");

        require(
            isRelayManagerStaked(relayManager),
            "relay manager not staked"
        );

        for (uint256 i = 0; i < newRelayWorkers.length; i++) {
            require(workerToManager[newRelayWorkers[i]] == address(0), "this worker has a manager");
            workerToManager[newRelayWorkers[i]] = relayManager;
        }

        emit RelayWorkersAdded(relayManager, newRelayWorkers, newWorkerCount);
    }

    function depositFor(address target) public override payable {
        uint256 amount = msg.value;
        require(amount <= config.maximumRecipientDeposit, "deposit too big");

        balances[target] = balances[target]+amount;

        emit Deposited(target, msg.sender, amount);
    }

    function balanceOf(address target) external override view returns (uint256) {
        return balances[target];
    }

    function withdraw(uint256 amount, address payable dest) public override {
        address payable account = payable(msg.sender);
        require(balances[account] >= amount, "insufficient funds");

        balances[account] = balances[account]-amount;
        dest.transfer(amount);

        emit Withdrawn(account, dest, amount);
    }

    function calldataGasCost(uint256 length) public override view returns (uint256) {
        return config.dataGasCostPerByte * length;
}

    function verifyGasAndDataLimits(
        uint256 maxAcceptanceBudget,
        GsnTypes.RelayRequest calldata relayRequest,
        uint256 initialGasLeft,
        uint256 externalGasLimit
    )
    private
    view
    returns (IPaymaster.GasAndDataLimits memory gasAndDataLimits, uint256 maxPossibleGas) {
        gasAndDataLimits =
            IPaymaster(relayRequest.relayData.paymaster).getGasAndDataLimits{gas:50000}();
        require(msg.data.length <= gasAndDataLimits.calldataSizeLimit, "msg.data exceeded limit" );
        uint256 dataGasCost = calldataGasCost(msg.data.length);
        // console.log("externalGasLimit: ", externalGasLimit);
        // console.log("initialGasLeft: ",initialGasLeft);
        // console.log("config.externalCallDataCostOverhead: ",config.externalCallDataCostOverhead);
        uint256 externalCallDataCost = externalGasLimit - initialGasLeft - config.externalCallDataCostOverhead;
        uint256 txDataCostPerByte = externalCallDataCost/msg.data.length;
        // console.log("G_NONZERO : ",G_NONZERO);
        // console.log("txDataCostPerByte : ",txDataCostPerByte);
        // console.log("externalCallDataCost: ",externalCallDataCost);
        // console.log("msg.data.length : ",msg.data.length);
        // console.log("txDataCostPerByte : ",txDataCostPerByte);

        require(txDataCostPerByte <= G_NONZERO, "invalid externalGasLimit");

        require(maxAcceptanceBudget >= gasAndDataLimits.acceptanceBudget, "acceptance budget too high");
        require(gasAndDataLimits.acceptanceBudget >= gasAndDataLimits.preRelayedCallGasLimit, "acceptance budget too low");

        maxPossibleGas =
            config.gasOverhead +
            gasAndDataLimits.preRelayedCallGasLimit +
            gasAndDataLimits.postRelayedCallGasLimit +
            relayRequest.request.gas +
            dataGasCost +
            externalCallDataCost;

        // console.log("gasAndDataLimits.preRelayedCallGasLimit: ",gasAndDataLimits.preRelayedCallGasLimit);
        // console.log("gasAndDataLimits.postRelayedCallGasLimit: ",gasAndDataLimits.postRelayedCallGasLimit);
        // This transaction must have enough gas to forward the call to the recipient with the requested amount, and not
        // run out of gas later in this function.
        // console.log("externalGasLimit: ",externalGasLimit);
        // console.log("maxPossibleGas: ",maxPossibleGas);

        require(
            externalGasLimit >= maxPossibleGas,
            "no gas for innerRelayCall");

        uint256 maxPossibleCharge = calculateCharge(
            maxPossibleGas,
            relayRequest.relayData
        );

        // We don't yet know how much gas will be used by the recipient, so we make sure there are enough funds to pay
        // for the maximum possible charge.
        require(maxPossibleCharge <= balances[relayRequest.relayData.paymaster],
            "Paymaster balance too low");
    }

    struct RelayCallData {
        bool success;
        bytes4 functionSelector;
        uint256 initialGasLeft;
        bytes recipientContext;
        bytes relayedCallReturnValue;
        IPaymaster.GasAndDataLimits gasAndDataLimits;
        RelayCallStatus status;
        uint256 innerGasUsed;
        uint256 maxPossibleGas;
        uint256 gasBeforeInner;
        bytes retData;
        address relayManager;
        uint256 dataGasCost;
    }

    function relayCall(
        uint maxAcceptanceBudget,
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint externalGasLimit
    )
    external
    override
    returns (bool paymasterAccepted, bytes memory returnValue)
    {
        RelayCallData memory vars;
        vars.initialGasLeft = gasleft();
        require(!isDeprecated(), "hub deprecated");
        vars.functionSelector = relayRequest.request.data.length>=4 ? MinLibBytes.readBytes4(relayRequest.request.data, 0) : bytes4(0);
        require(msg.sender == tx.origin, "relay worker must be EOA");
        vars.relayManager = workerToManager[msg.sender];
        require(vars.relayManager != address(0), "Unknown relay worker");
        require(relayRequest.relayData.relayWorker == msg.sender, "Not a right worker");
        require(
            isRelayManagerStaked(vars.relayManager),
            "relay manager not staked"
        );
        require(relayRequest.relayData.gasPrice <= tx.gasprice, "Invalid gas price");
        require(externalGasLimit <= block.gaslimit, "Impossible gas limit");

        (vars.gasAndDataLimits, vars.maxPossibleGas) =
             verifyGasAndDataLimits(maxAcceptanceBudget, relayRequest, vars.initialGasLeft, externalGasLimit);

        RelayHubValidator.verifyTransactionPacking(relayRequest,signature,approvalData);

    {

        //How much gas to pass down to innerRelayCall. must be lower than the default 63/64
        // actually, min(gasleft*63/64, gasleft-GAS_RESERVE) might be enough.
        // console.log("gasleft()*63/64: ",gasleft()*63/64);
        // console.log("config.gasReserve: ",config.gasReserve);
        // console.log(" gasleft()*63/64 - config.gasReserve: ", gasleft()*63/64 - config.gasReserve);
        uint256 innerGasLimit = gasleft()*63/64 - config.gasReserve;
        vars.gasBeforeInner = gasleft();

        uint256 _tmpInitialGas = innerGasLimit + externalGasLimit + config.gasOverhead + config.postOverhead;
        
        // console.log("_tmpInitialGas: ",_tmpInitialGas);
        // console.log("vars.gasBeforeInner: ",vars.gasBeforeInner);
        // Calls to the recipient are performed atomically inside an inner transaction which may revert in case of
        // errors in the recipient. In either case (revert or regular execution) the return data encodes the
        // RelayCallStatus value.
        (bool success, bytes memory relayCallStatus) = address(this).call{gas:innerGasLimit}(
            abi.encodeWithSelector(RelayHub.innerRelayCall.selector, relayRequest, signature, approvalData, vars.gasAndDataLimits,
                _tmpInitialGas - gasleft(),
                vars.maxPossibleGas
                )
        );
        
        // console.log("success: ",success);
        // console.log("Status length:", relayCallStatus.length);
        // console.logBytes(relayCallStatus); // 첫 32바이트까지만
        // console.logBytes32(keccak256(relayCallStatus)); // 전체 내용 해시
        
        vars.success = success;
        vars.innerGasUsed = vars.gasBeforeInner-gasleft();

        // console.log("vars.innerGasUsed: ",vars.innerGasUsed);
        // console.log("vars.relayedCallReturnValue: ",string(vars.relayedCallReturnValue));
        (vars.status, vars.relayedCallReturnValue) = abi.decode(relayCallStatus, (RelayCallStatus, bytes));
        if ( vars.relayedCallReturnValue.length>0 ) {
            emit TransactionResult(vars.status, vars.relayedCallReturnValue);
        }
    }
    {
        vars.dataGasCost = calldataGasCost(msg.data.length);
        // console.log("dataGasCost",vars.dataGasCost);
        // console.log("innerGasUsed",vars.innerGasUsed);
        // console.log("gasAndDataLimits.acceptanceBudget",vars.gasAndDataLimits.acceptanceBudget);
        // console.log("is RejectedByPreRelayed : ",RelayCallStatus.RejectedByPreRelayed == vars.status);
        // console.log("is RejectedByForwarder : ",RelayCallStatus.RejectedByForwarder == vars.status);
        // console.log("is RejectedByRecipientRevert : ",RelayCallStatus.RejectedByRecipientRevert == vars.status);
        if (!vars.success) {
            //Failure cases where the PM doesn't pay
            if (vars.status == RelayCallStatus.RejectedByPreRelayed ||
                    (vars.innerGasUsed <= vars.gasAndDataLimits.acceptanceBudget + vars.dataGasCost) && (
                    vars.status == RelayCallStatus.RejectedByForwarder ||
                    vars.status == RelayCallStatus.RejectedByRecipientRevert  //can only be thrown if rejectOnRecipientRevert==true
            )) {
                paymasterAccepted=false;

                emit TransactionRejectedByPaymaster(
                    vars.relayManager,
                    relayRequest.relayData.paymaster,
                    relayRequest.request.from,
                    relayRequest.request.to,
                    msg.sender,
                    vars.functionSelector,
                    vars.innerGasUsed,
                    vars.relayedCallReturnValue);
                return (false, vars.relayedCallReturnValue);
            }
        }
        // We now perform the actual charge calculation, based on the measured gas used
        uint256 gasUsed = (externalGasLimit - gasleft()) + config.gasOverhead;
        uint256 charge = calculateCharge(gasUsed, relayRequest.relayData);

        balances[relayRequest.relayData.paymaster] = balances[relayRequest.relayData.paymaster] - charge;
        balances[vars.relayManager] = balances[vars.relayManager] + charge;

        emit TransactionRelayed(
            vars.relayManager,
            msg.sender,
            relayRequest.request.from,
            relayRequest.request.to,
            relayRequest.relayData.paymaster,
            vars.functionSelector,
            vars.status,
            charge);
        return (true, "");
    }
    }

    struct InnerRelayCallData {
        uint256 balanceBefore;
        bytes32 preReturnValue;
        bool relayedCallSuccess;
        bytes relayedCallReturnValue;
        bytes recipientContext;
        bytes data;
        bool rejectOnRecipientRevert;
    }

    function innerRelayCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        IPaymaster.GasAndDataLimits calldata gasAndDataLimits,
        uint256 totalInitialGas,
        uint256 maxPossibleGas
    )
    external
    returns (RelayCallStatus, bytes memory)
    {
        InnerRelayCallData memory vars;
        // A new gas measurement is performed inside innerRelayCall, since
        // due to EIP150 available gas amounts cannot be directly compared across external calls

        // This external function can only be called by RelayHub itself, creating an internal transaction. Calls to the
        // recipient (preRelayedCall, the relayedCall, and postRelayedCall) are called from inside this transaction.
        require(msg.sender == address(this), "Must be called by RelayHub");

        // If either pre or post reverts, the whole internal transaction will be reverted, reverting all side effects on
        // the recipient. The recipient will still be charged for the used gas by the relay.

        // The paymaster is no allowed to withdraw balance from RelayHub during a relayed transaction. We check pre and
        // post state to ensure this doesn't happen.
        vars.balanceBefore = balances[relayRequest.relayData.paymaster];

        // First preRelayedCall is executed.
        // Note: we open a new block to avoid growing the stack too much.
        vars.data = abi.encodeWithSelector(
            IPaymaster.preRelayedCall.selector,
                relayRequest, signature, approvalData, maxPossibleGas
        );
        {
            bool success;
            bytes memory retData;
            (success, retData) = relayRequest.relayData.paymaster.call{gas:gasAndDataLimits.preRelayedCallGasLimit}(vars.data);
            if (!success) {
                GsnEip712Library.truncateInPlace(retData);
                revertWithStatus(RelayCallStatus.RejectedByPreRelayed, retData);
            }
            (vars.recipientContext, vars.rejectOnRecipientRevert) = abi.decode(retData, (bytes,bool));
        }

        // The actual relayed call is now executed. The sender's address is appended at the end of the transaction data

        {
            bool forwarderSuccess;
            (forwarderSuccess, vars.relayedCallSuccess, vars.relayedCallReturnValue) = GsnEip712Library.execute(relayRequest, signature);
            if ( !forwarderSuccess ) {
                revertWithStatus(RelayCallStatus.RejectedByForwarder, vars.relayedCallReturnValue);
            }

            if (vars.rejectOnRecipientRevert && !vars.relayedCallSuccess) {
                // we trusted the recipient, but it reverted...
                revertWithStatus(RelayCallStatus.RejectedByRecipientRevert, vars.relayedCallReturnValue);
            }
        }
        // Finally, postRelayedCall is executed, with the relayedCall execution's status and a charge estimate
        // We now determine how much the recipient will be charged, to pass this value to postRelayedCall for accurate
        // accounting.
        vars.data = abi.encodeWithSelector(
            IPaymaster.postRelayedCall.selector,
            vars.recipientContext,
            vars.relayedCallSuccess,
            totalInitialGas - gasleft(), /*gasUseWithoutPost*/
            relayRequest.relayData
        );

        {
        (bool successPost,bytes memory ret) = relayRequest.relayData.paymaster.call{gas:gasAndDataLimits.postRelayedCallGasLimit}(vars.data);

        if (!successPost) {
            revertWithStatus(RelayCallStatus.PostRelayedFailed, ret);
        }
        }

        if (balances[relayRequest.relayData.paymaster] < vars.balanceBefore) {
            revertWithStatus(RelayCallStatus.PaymasterBalanceChanged, "");
        }

        return (vars.relayedCallSuccess ? RelayCallStatus.OK : RelayCallStatus.RelayedCallFailed, vars.relayedCallReturnValue);
    }

    /**
     * @dev Reverts the transaction with return data set to the ABI encoding of the status argument (and revert reason data)
     */
    function revertWithStatus(RelayCallStatus status, bytes memory ret) private pure {
        bytes memory data = abi.encode(status, ret);
        GsnEip712Library.truncateInPlace(data);

        assembly {
            let dataSize := mload(data)
            let dataPtr := add(data, 32)

            revert(dataPtr, dataSize)
        }
    }

    function calculateCharge(uint256 gasUsed, GsnTypes.RelayData calldata relayData) public override virtual view returns (uint256) {
        return relayData.baseRelayFee + ((gasUsed * (relayData.gasPrice * (relayData.pctRelayFee + 100))/100));
    }

    function isRelayManagerStaked(address relayManager) public override view returns (bool) {
        return stakeManager.isRelayManagerStaked(relayManager, address(this), config.minimumStake, config.minimumUnstakeDelay);
    }

    function deprecateHub(uint256 fromBlock) public override onlyOwner {
        require(deprecationBlock > block.number, "Already deprecated");
        deprecationBlock = fromBlock;
        emit HubDeprecated(fromBlock);
    }

    function isDeprecated() public override view returns (bool) {
        return block.number >= deprecationBlock;
    }

    modifier penalizerOnly () {
        require(msg.sender == penalizer, "Not penalizer");
        _;
    }

    function penalize(address relayWorker, address payable beneficiary) external override penalizerOnly {
        address relayManager = workerToManager[relayWorker];
        // The worker must be controlled by a manager with a locked stake
        require(relayManager != address(0), "Unknown relay worker");
        IStakeManager.StakeInfo memory stakeInfo = stakeManager.getStakeInfo(relayManager);
        require(stakeInfo.stake > 0, "relay manager not staked");
        stakeManager.penalizeRelayManager(relayManager, beneficiary, stakeInfo.stake);
    }
}
