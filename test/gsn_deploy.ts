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

    const stakeManagerFactory = await ethers.getContractFactory("StakeManager");

    const penalizerFactory = await ethers.getContractFactory("Penalizer");

    const relayHubFactory = await ethers.getContractFactory("RelayHub");

    const forwarderFactory = await ethers.getContractFactory("Forwarder");

    const zeroPaymasterFactory =
      await ethers.getContractFactory("ZeroPaymaster");

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

    //MARK: deploy Paymaster
    zeroPaymaster = await zeroPaymasterFactory.deploy(
      relayHub.address,
      forwarder.address,
    );

    await zeroPaymaster.deployed();
  });

  it("deployed StakeManager", async () => {
    expect(!!stakeManager.address).equal(!!stakeManager.address);
  });

  it("deployed Penalizer", async () => {
    expect(!!penalizer.address).equal(!!penalizer.address);
  });

  it("deployed RelayHub", async () => {
    expect(!!relayHub.address).equal(!!relayHub.address);
  });

  it("deployed Forwarder", async () => {
    expect(!!forwarder.address).equal(!!forwarder.address);
  });

  it("deployed Paymaster", async () => {
    expect(!!zeroPaymaster.address).equal(!!zeroPaymaster.address);
  });

  after(async () => {
    console.log("💎 StakeManager : ", stakeManager.address);
    console.log("💎 Penalizer : ", penalizer.address);
    console.log("💎 RelayHub : ", relayHub.address);
    console.log("💎 Forwarder : ", forwarder.address);
    console.log("💎 Paymaster : ", zeroPaymaster.address);
  });
});
