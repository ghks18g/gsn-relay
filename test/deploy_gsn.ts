import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { ethers, config } from "hardhat";

import { BigNumber, providers, Wallet } from "ethers";
import {
  ClamCoin,
  Forwarder,
  Penalizer,
  RelayHub,
  StakeManager,
  ZeroPaymaster,
} from "../typechain-types";
import { expect } from "chai";

interface MessageTypeProperty {
  name: string;
  type: string;
}

interface MessageTypes {
  // EIP712Domain: MessageTypeProperty[];
  [additionalProperties: string]: MessageTypeProperty[];
}

function getEIP712MessageForGasFreeTransaction(
  domainName: string,
  domainVersion: string,
  chainId: number,
  forwarderAddress: string,
  data: string,
  from: string,
  to: string,
  gas: BigNumber,
  nonce: BigNumber,
  value?: BigNumber,
) {
  const types: MessageTypes = {
    // EIP712Domain: [
    //   { name: "name", type: "string" },
    //   { name: "version", type: "string" },
    //   { name: "chainId", type: "uint256" },
    //   { name: "verifyingContract", type: "address" },
    // ],
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "validUntil", type: "uint256" },
    ],
  };

  const message = {
    from: from,
    to: to,
    value: value ?? BigNumber.from(0),
    gas: gas.toHexString(),
    nonce: nonce.toHexString(),
    data,
    validUntil: String(
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    ),
  };

  const result = {
    domain: {
      name: domainName,
      version: domainVersion,
      chainId: chainId,
      verifyingContract: forwarderAddress,
    },
    types: types,
    primaryType: "ForwardRequest",
    message: message,
  };

  return result;
}

describe("Deploy GSN Contract ", async () => {
  let owner: Wallet;

  let relayManager: Wallet;

  let relayWorker: Wallet;

  let stakeManager: StakeManager;

  let penalizer: Penalizer;

  let relayHub: RelayHub;

  let forwarder: Forwarder;

  let zeroPaymaster: ZeroPaymaster;

  let clamCoin: ClamCoin;

  let domainHash: string = "";
  let domainValue: string = "";

  before(async () => {
    const [operator] = await ethers.getSigners();

    const balance = await operator.getBalance();

    console.log("balance: ", balance, " / ", ethers.utils.formatEther(balance));

    if (!operator.provider) {
      throw new Error("provider is undefined");
    }

    owner = ethers.Wallet.createRandom().connect(operator.provider);

    relayManager = ethers.Wallet.createRandom().connect(operator.provider);

    relayWorker = ethers.Wallet.createRandom().connect(operator.provider);

    const sendNativeToOwner = await operator.sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther("1000"),
    });

    await sendNativeToOwner.wait();

    const sendNativeToRelayManager = await operator.sendTransaction({
      to: relayManager.address,
      value: ethers.utils.parseEther("1000"),
    });

    await sendNativeToRelayManager.wait();

    const sendNativeToRelayWorker = await operator.sendTransaction({
      to: relayWorker.address,
      value: ethers.utils.parseEther("1000"),
    });

    await sendNativeToRelayWorker.wait();

    const stakeManagerFactory = await ethers.getContractFactory("StakeManager");

    const penalizerFactory = await ethers.getContractFactory("Penalizer");

    const relayHubFactory = await ethers.getContractFactory("RelayHub");

    const forwarderFactory = await ethers.getContractFactory("Forwarder");

    const zeroPaymasterFactory =
      await ethers.getContractFactory("ZeroPaymaster");

    const clamCoinFactory = await ethers.getContractFactory("ClamCoin");

    //MARK: deploy StakeManager
    stakeManager = await stakeManagerFactory.deploy();

    await stakeManager.deployed();

    //MARK: deploy Penalizer
    penalizer = await penalizerFactory.deploy();

    await penalizer.deployed();

    //MARK: deploy RelayHub
    relayHub = await relayHubFactory.deploy(
      stakeManager.address,
      penalizer.address,
      1,
      BigNumber.from(300_000), //_gasReserve
      BigNumber.from(30_000), // _postOverhead
      BigNumber.from(10_000), // _gasOverhead
      ethers.utils.parseEther("1000000"), // _maximumRecipientDeposit
      BigNumber.from(0), // _minimumUnstakeDelay
      ethers.utils.parseEther("0.1"), // _minimumStake
      BigNumber.from(16), // _dataGasCostPerByte
      BigNumber.from(120_000), // _externalCallDataCostOverhead
    );
    await relayHub.deployed();

    //MARK: deploy Forwarder
    forwarder = await forwarderFactory.deploy();

    await forwarder.deployed();

    //MARK: Regist Domain Seperator
    const registerDomainSeparatorTx = await forwarder.registerDomainSeparator(
      "GSN Relayed Transaction",
      "2",
    );

    const registerDomainSeparatorReceipt =
      await registerDomainSeparatorTx.wait();

    // console.log(
    //   "registerDomainSeparatorReceipt: ",
    //   registerDomainSeparatorReceipt,
    // );

    for (const log of registerDomainSeparatorReceipt.logs) {
      const parsedLog = forwarder.interface.parseLog(log);
      if (parsedLog.name === "DomainRegistered") {
        domainHash = parsedLog.args[0];
        domainValue = parsedLog.args[1];
        console.log("DomainRegistered event found:");
        console.log("domainHash:", domainHash);
        console.log("domainValue:", domainValue);
      }
    }

    //MARK: Regist RequestType
    const GENERIC_PARAMS =
      "address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,uint256 validUntil";

    const RELAYDATA_TYPE =
      "RelayData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee,address relayWorker,address paymaster,address forwarder,bytes paymasterData,uint256 clientId)";

    const RELAY_REQUEST_NAME = "RelayRequest";

    const RELAY_REQUEST_SUFFIX = `RelayData relayData)${RELAYDATA_TYPE}`;

    const RELAY_REQUEST_TYPE = `${RELAY_REQUEST_NAME}(${GENERIC_PARAMS},RelayData relayData)${RELAYDATA_TYPE}`;

    // console.log(RELAY_REQUEST_TYPE);

    const registerRequestTypeTx = await forwarder.registerRequestType(
      RELAY_REQUEST_NAME,
      RELAY_REQUEST_SUFFIX,
    );

    const registerRequestTypeReceipt = await registerRequestTypeTx.wait();

    for (const log of registerRequestTypeReceipt.logs) {
      const parsedLog = forwarder.interface.parseLog(log);
      if (parsedLog.name === "RequestTypeRegistered") {
        const typeHash = parsedLog.args.typeHash;
        const typeStr = parsedLog.args.typeStr;
        console.log("RequestTypeRegistered event found:");
        console.log("typeHash:", typeHash);
        console.log("typeName:", typeStr);
      }
    }

    const genericParams = `address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,uint256 validUntil`;
    const typeString = `ForwardRequest(${genericParams})`;
    const typeStrToBytes = ethers.utils.toUtf8Bytes(typeString);
    console.log("typeString: ", typeString);
    console.log(`typeStrToBytes: `, typeStrToBytes);
    const typeHash = ethers.utils.keccak256(typeStrToBytes);
    console.log(
      "typeHash: ",
      typeHash,
      "/ forwarder registered: ",
      await forwarder.typeHashes(typeHash),
    );

    //MARK: deploy Paymaster
    zeroPaymaster = await zeroPaymasterFactory.deploy(
      relayHub.address,
      forwarder.address,
    );

    await zeroPaymaster.deployed();

    //MARK: deploy ClamCoin
    clamCoin = await clamCoinFactory.connect(owner).deploy(forwarder.address);

    await clamCoin.deployed();

    //MARK: set Relay Manager Owner
    const setRelayManagerOwnerTx = await stakeManager
      .connect(relayManager)
      .setRelayManagerOwner(owner.address);

    const setRelayManagerOwnerReceipt = await setRelayManagerOwnerTx.wait();
    // console.log(`setRelayManagerOwnerReceipt: `, setRelayManagerOwnerReceipt);

    console.log(
      "authorizeHubByManager: ",
      await stakeManager
        .connect(relayManager)
        .authorizeHubByManager(relayHub.address),
    );
    //MARK: stake relayManager
    console.log(
      "==================================[stake relay manager]====================================",
    );

    const stakeInfo = await stakeManager.getStakeInfo(relayManager.address);
    console.log(`stakeInfo: `, stakeInfo);

    const stakeRelayManagerTx = await stakeManager
      .connect(owner)
      .stakeForRelayManager(relayManager.address, 0, {
        value: ethers.utils.parseEther("2"),
      });
    const stakeRelayManagerReceipt = await stakeRelayManagerTx.wait();

    console.log(`stakeRelayManagerReceipt: `, stakeRelayManagerReceipt);

    console.log(
      "==================================[stake relay manager]====================================",
    );

    //MARK: Authorize RelayHub
    console.log(
      "==================================[Authorize RelayHub]====================================",
    );
    const authorizeHubByOwnerTx = await stakeManager
      .connect(owner)
      .authorizeHubByOwner(relayManager.address, relayHub.address);
    const authorizeHubByOwnerReceipt = await authorizeHubByOwnerTx.wait();
    // console.log(`authorizeHubByOwnerReceipt: `, authorizeHubByOwnerReceipt);

    console.log(
      "==================================[Authorize RelayHub]====================================",
    );
    console.log(
      "==================================[add RelayWorker]====================================",
    );

    console.log("RelayHub Config: ", await relayHub.getConfiguration());
    console.log(
      "RelayManager Staking Check(stakeManager): ",
      await stakeManager.isRelayManagerStaked(
        relayManager.address,
        relayHub.address,
        ethers.utils.parseEther("0.1"),
        BigNumber.from(0),
      ),
    );
    console.log(
      "RelayManager Staking Check(relayHub): ",
      await relayHub.isRelayManagerStaked(relayManager.address),
    );
    //MARK: add RelayWorker
    const addRelayWorkerTx = await relayHub
      .connect(relayManager)
      .addRelayWorkers([relayWorker.address]);

    const addRelayWorkerReceipt = await addRelayWorkerTx.wait();

    // console.log(`addRelayWorkerReceipt: `, addRelayWorkerReceipt);
    console.log(
      "==================================[add RelayWorker]====================================",
    );
    console.log(
      "==================================[register relay manager]====================================",
    );

    const afterStakeInfo = await stakeManager.getStakeInfo(
      relayManager.address,
    );
    console.log(await relayHub.isRelayManagerStaked(relayManager.address));

    console.log(await relayHub.getConfiguration());
    console.log(`afterStakeInfo: `, afterStakeInfo);
    //MARK: register relay manager
    const registerRelayServerTx = await relayHub
      .connect(relayManager)
      .registerRelayServer(
        BigNumber.from(0),
        BigNumber.from(0),
        "https://dummy-relay",
      );

    const registerRelayServerReceipt = await registerRelayServerTx.wait();
    // console.log(`registerRelayServerReceipt: `, registerRelayServerReceipt);
    console.log(
      "==================================[register relay manager]====================================",
    );
  });

  it("deployed StakeManager", async () => {
    console.log("💎 StakeManager : ", stakeManager.address);
    expect(!!stakeManager.address).equal(!!stakeManager.address);
  });

  it("deployed Penalizer", async () => {
    console.log("💎 Penalizer : ", penalizer.address);
    expect(!!penalizer.address).equal(!!penalizer.address);
  });

  it("deployed RelayHub", async () => {
    console.log("💎 RelayHub : ", relayHub.address);
    expect(!!relayHub.address).equal(!!relayHub.address);
  });

  it("deployed Forwarder", async () => {
    console.log("💎 Forwarder : ", forwarder.address);
    expect(!!forwarder.address).equal(!!forwarder.address);
  });

  it("deployed Paymaster", async () => {
    console.log("💎 Paymaster : ", zeroPaymaster.address);
    expect(!!zeroPaymaster.address).equal(!!zeroPaymaster.address);
  });

  it("deployed Paymaster", async () => {
    const [nameOfCLAM, symbolOfCLAM, balance, decimals, trustedForwarder] =
      await Promise.all([
        clamCoin.name(),
        clamCoin.symbol(),
        clamCoin.balanceOf(owner.address),
        clamCoin.decimals(),
        clamCoin.trustedForwarder(),
      ]);
    console.log(
      `💎 ClamCoin (${nameOfCLAM} / ${symbolOfCLAM}) : `,
      clamCoin.address,
    );

    console.log("trustedForwarder:", trustedForwarder);

    console.log(
      `${owner.address} balance: ${balance} (${ethers.utils.formatUnits(balance, decimals)})`,
    );
    expect(!!clamCoin.address).equal(!!clamCoin.address);
  });

  it("Test GasFree Transfer", async () => {
    // Fund Paymaster
    const fundTx = await owner.sendTransaction({
      to: zeroPaymaster.address,
      value: ethers.utils.parseEther("1"),
    });
    const fundReceipt = await fundTx.wait();
    console.log(
      "======================================================================",
    );
    // console.log("fundReceipt:", fundReceipt);
    console.log(
      "======================================================================",
    );

    const eoa = relayManager.address;
    const amount = ethers.utils.parseEther("100");
    const data = clamCoin.interface.encodeFunctionData("transfer", [
      //   owner.address,
      eoa,
      amount,
    ]);
    const gas = await clamCoin.connect(owner).estimateGas.transfer(eoa, amount);
    // const gas = BigNumber.from(200000);
    const nonce = await forwarder.getNonce(owner.address);
    const chainId = (await owner.provider?.getNetwork())?.chainId;

    if (!chainId) {
      throw new Error("Chain Id is undefined");
    }

    const eip712Request = getEIP712MessageForGasFreeTransaction(
      "GSN Relayed Transaction",
      "2",
      chainId,
      forwarder.address,
      data,
      owner.address,
      clamCoin.address,
      gas,
      nonce,
    );
    console.log("eip712Request:", eip712Request);

    // Sign request
    const signature = await owner._signTypedData(
      eip712Request.domain,
      eip712Request.types,
      {
        ...eip712Request.message,
      },
    );

    const recovered = ethers.utils.verifyTypedData(
      eip712Request.domain,
      eip712Request.types,
      {
        ...eip712Request.message,
      },
      signature,
    );

    console.log("recovered: ", recovered);
    if (recovered.toLowerCase() !== owner.address.toLowerCase()) {
      throw new Error("Invalid signature");
    }

    console.log(
      `${owner.address} balanceOf ClaimCoin : `,
      await clamCoin.balanceOf(owner.address),
    );

    // RelayData 객체 (relay 서버에서 설정)
    const relayData = {
      gasPrice: await relayManager.getGasPrice(),
      pctRelayFee: 0,
      baseRelayFee: 0,
      relayWorker: relayWorker.address,
      paymaster: zeroPaymaster.address,
      forwarder: forwarder.address,
      paymasterData: "0x",
      clientId: 0,
    };

    const relayRequest = {
      request: {
        from: eip712Request.message.from,
        to: eip712Request.message.to,
        value: eip712Request.message.value,
        gas: eip712Request.message.gas,
        nonce: eip712Request.message.nonce,
        data: eip712Request.message.data,
        validUntil: eip712Request.message.validUntil,
      },
      relayData: relayData,
    };

    console.log("domain registered ? ", await forwarder.domains(domainHash));

    const relayExcuteTx = await relayHub.connect(relayWorker).relayCall(
      BigNumber.from(500_000),
      {
        request: relayRequest.request,
        relayData: relayRequest.relayData,
      },
      //   workerSignature,
      signature,
      "0x", // approvalData
      //   500_000, // external Gas limit,
      //   1_100_000,
      5_000_000, // external Gas limit,
      {
        gasLimit: 4_900_000,
      },
    );

    const relayExcuteReceipt = await relayExcuteTx.wait();
    console.log("relayExcuteReceipt:", relayExcuteReceipt);

    const event = relayExcuteReceipt.events?.find(
      (e) => e.event === "TransactionRejectedByPaymaster",
    );
    if (!!event) {
      console.log(event?.args);
      console.log("Rejected Reason:", event?.args?.reason);
    }

    console.log(
      `after ${owner.address} balanceOf ClaimCoin : `,
      await clamCoin.balanceOf(owner.address),
    );

    // console.log(typeString);
    // console.log(typeHash2);
    // console.log(typeHash);

    // console.log(await forwarder.typeHashes(typeHash));
    // console.log(await forwarder.typeHashes(typeHash2));

    // Simulate relayCall
    await expect(!!relayExcuteReceipt).to.equal(!!relayExcuteReceipt);
  });

  after(async () => {
    const ownerNative = await owner.getBalance();
    const ownerCLAM = await clamCoin.balanceOf(owner.address);
    const relayManagerNative = await relayManager.getBalance();
    const relayManagerCLAM = await clamCoin.balanceOf(relayManager.address);
    const relayWorkerNative = await relayWorker.getBalance();
    console.log(`-------------------- ${owner.address} --------------------`);
    console.log(
      `\tNative : ${ownerNative} / (${ethers.utils.formatEther(ownerNative)})`,
    );
    console.log(
      `\tCLAM : ${ownerCLAM} / (${ethers.utils.formatEther(ownerCLAM)})`,
    );

    console.log(
      `-------------------- ${relayManager.address} --------------------`,
    );
    console.log(
      `\tNative : ${relayManagerNative} / (${ethers.utils.formatEther(relayManagerNative)})`,
    );
    console.log(
      `\tCLAM : ${relayManagerCLAM} / (${ethers.utils.formatEther(relayManagerCLAM)})`,
    );

    console.log(
      `-------------------- ${relayWorker.address} --------------------`,
    );
    console.log(
      `\tNative : ${relayWorkerNative} / (${ethers.utils.formatEther(relayWorkerNative)})`,
    );
  });
});

/**
 * externalGasLimit - initialGasLeft - config.externalCallDataCostOverhead
 *
 * 350000 29011962 100
 */
