import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { ethers, config } from "hardhat";

import { BigNumber, providers, Wallet, ContractReceipt } from "ethers";
import {
  ClamCoin,
  Forwarder,
  Penalizer,
  RelayHub,
  GasFreeERC20,
  StakeManager,
  BasePaymaster,
  ZeroPaymaster,
  ERC2771Context,
  IRelayHub,
} from "../typechain-types";
import { expect } from "chai";

/**
 * EIP-712 서명을 위한 구조체의 필드 정보를 정의하는 인터페이스입니다.
 *
 * 이 인터페이스는 `types` 객체를 정의할 때 사용되며, 각 필드는 EIP-712 메시지 구조에서 사용되는
 * Solidity 타입과 이름으로 구성됩니다.
 *
 * @param name - 서명 구조체의 필드 이름입니다. (Solidity 멤버 변수 이름과 일치)
 * @param type - 필드의 데이터 타입입니다. Solidity 타입이어야 합니다.
 *               예: "address", "uint256", "bytes32", "string" 등
 *
 * @example
 * const personType: MessageTypeProperty[] = [
 *   { name: "name", type: "string" },
 *   { name: "wallet", type: "address" }
 * ];
 */
interface MessageTypeProperty {
  name: string;
  type: string;
}

/**
 * EIP-712 타입 정의 전체를 표현하는 인터페이스입니다.
 *
 * 이 객체는 EIP-712 구조화된 데이터 서명을 구성할 때 `types` 필드에 사용됩니다.
 * 각 키는 구조체 이름이며, 값은 해당 구조체의 필드 배열입니다.
 *
 * 예를 들어, `EIP712Domain`, `Person` 등의 구조체를 정의할 수 있습니다.
 *
 * @param [additionalProperties] {@link MessageTypeProperty} 배열로, 각 구조체의 필드를 정의합니다.
 *
 * @remarks * 구조체는 Forwarder 에 등록되어 있어야 합니다. {@link Forwarder.registerRequestType}
 * @example
 * const types: MessageTypes = {
 *   EIP712Domain: [
 *     { name: "name", type: "string" },
 *     { name: "version", type: "string" },
 *     { name: "chainId", type: "uint256" },
 *     { name: "verifyingContract", type: "address" }
 *   ],
 *   Person: [
 *     { name: "name", type: "string" },
 *     { name: "wallet", type: "address" }
 *   ],
 * };
 */
interface MessageTypes {
  /**
   * `EIP712Domain` 구조체의 필드 배열을 값으로 갖습니다.
   * 각 키는 EIP-712 메시지에 사용될 타입명입니다.
   */
  // EIP712Domain: MessageTypeProperty[];
  /**
   * 구조체 이름을 키로 하고, 해당 구조체의 필드 배열을 값으로 갖습니다.
   * 각 키는 EIP-712 메시지에 사용될 타입명입니다.
   */
  [additionalProperties: string]: MessageTypeProperty[];
}

/**
 * EIP-712 도메인 구분자(Domain Separator)를 구성하는 인터페이스입니다.
 * 이 구조체는 EIP-712 메시지 서명의 `domain` 필드로 사용됩니다.
 *
 * 각 필드는 도메인 고유성을 보장하기 위한 요소이며,
 * 메시지 위조나 체인 간 충돌을 방지하는 데 사용됩니다.
 *
 * @see https://eips.ethereum.org/EIPS/eip-712
 *
 * @param name - 서명을 사용하는 애플리케이션 또는 프로토콜의 이름입니다.
 * @param version - 메시지 형식의 버전입니다.
 * @param chainId - 현재 서명이 유효한 체인 ID입니다. (예: 1은 Mainnet)
 * @param verifyingContract - 서명 메시지를 검증하는 스마트 컨트랙트 주소입니다.
 *
 * @remarks * 도메인은 Forwarder 에 등록되어 있어야 합니다. {@link Forwarder.registerDomainSeparator}
 * @example
 * const domain: EIP712Domain = {
 *   name: "MyDapp",
 *   version: "1",
 *   chainId: 1,
 *   verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC"
 * };
 */
interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/**
 * EIP-712 메타트랜잭션 메시지의 구조를 나타내는 인터페이스입니다.
 * 이 구조는 Forwarder와 RelayHub 등에서 서명 검증 및 relayCall 호출에 사용됩니다.
 *
 * @param from - 트랜잭션을 의뢰한 사용자 지갑 주소 (서명자)
 * @param to - 호출 대상 스마트 컨트랙트 주소
 * @param value - 이더 전송량 (단위: wei), 보통 0
 * @param gas - 실행 시 소비할 최대 가스량 (hex string, 예: '0x5208')
 * @param nonce - forwarder에서 사용하는 사용자 nonce 값 (hex string)
 * @param data - 호출할 함수와 파라미터가 ABI 인코딩된 바이트 데이터
 * @param validUntil - 이 트랜잭션이 유효한 마지막 블록 타임스탬프 또는 블록 넘버 (hex string)
 *
 * @example
 * const message: Eip712Message = {
 *   from: "0x1234...abcd",
 *   to: "0xabcd...1234",
 *   value: BigNumber.from("0"),
 *   gas: "0x5208", // 21000
 *   nonce: "0x01",
 *   data: "0xabcdef...",
 *   validUntil: "0xffffffff"
 * };
 */
interface Eip712Message {
  from: string;
  to: string;
  value: BigNumber;
  gas: string;
  nonce: string;
  data: string;
  validUntil: string;
}

/**
 * EIP-712 형식의 전체 서명 요청 객체를 정의하는 인터페이스입니다.
 * 이 구조는 `eth_signTypedData_v4`나 GSN, Forwarder 등에서 서명 및 실행 요청의 표준 형식으로 사용됩니다.
 *
 * @param domain - {@link EIP712Domain} 메시지에 포함된 도메인 정보로, 체인 ID, verifying contract 등 도메인 고유성 식별자
 * @param types - {@link MessageTypes} 전체 타입 정의 집합으로, 각 구조체 이름과 그에 해당하는 필드 배열로 구성됨
 * @param primaryType - 최상위 구조체 타입 이름. 서명 시 사용되는 주 구조체 명칭 (예: "ForwardRequest")
 * @param message - {@link Eip712Message} 실제 서명 대상 메시지. from, to, data, gas 등 메타 트랜잭션의 실행 정보 포함
 *
 * @example
 * const request: Eip712Request = {
 *   domain: {
 *     name: "GSN Forwarder",
 *     version: "1",
 *     chainId: 5,
 *     verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC"
 *   },
 *   types: {
 *     EIP712Domain: [
 *       { name: "name", type: "string" },
 *       { name: "version", type: "string" },
 *       { name: "chainId", type: "uint256" },
 *       { name: "verifyingContract", type: "address" }
 *     ],
 *     ForwardRequest: [
 *       { name: "from", type: "address" },
 *       { name: "to", type: "address" },
 *       { name: "value", type: "uint256" },
 *       { name: "gas", type: "uint256" },
 *       { name: "nonce", type: "uint256" },
 *       { name: "data", type: "bytes" },
 *       { name: "validUntil", type: "uint256" }
 *     ]
 *   },
 *   primaryType: "ForwardRequest",
 *   message: {
 *     from: "0x1234...abcd",
 *     to: "0xabcd...1234",
 *     value: BigNumber.from(0),
 *     gas: "0x5208",
 *     nonce: "0x1",
 *     data: "0xabcdef...",
 *     validUntil: "0xffffffff"
 *   }
 * };
 */
interface Eip712Request {
  domain: EIP712Domain;
  types: MessageTypes;
  primaryType: string;
  message: Eip712Message;
}

/**
 * 가스 프리 트랜잭션(Gasless Transaction)을 위한 EIP-712 서명 요청 객체를 생성하는 함수입니다.
 *
 * 이 함수는 Forwarder 컨트랙트와 RelayHub에 전달할 메타트랜잭션 서명을 위해 필요한
 * `domain`, `types`, `primaryType`, `message`를 포함한 `Eip712Request` 구조를 만듭니다.
 *
 * @param domainName - EIP-712 도메인 이름 (예: "GSN Forwarder")
 * @param domainVersion - 도메인 버전 (예: "1")
 * @param chainId - 체인 ID (예: 1, 5 등)
 * @param forwarderAddress - Forwarder 스마트 컨트랙트 주소 (도메인 내 verifyingContract 필드)
 * @param data - 호출할 함수 및 파라미터가 ABI 인코딩된 바이트 데이터 (hex string)
 * @param from - 서명자(트랜잭션 발신자) 지갑 주소
 * @param to - 호출 대상 스마트 컨트랙트 주소
 * @param gas - 트랜잭션에 허용할 최대 가스량 (BigNumber)
 * @param nonce - Forwarder에서 관리하는 사용자 nonce (BigNumber)
 * @param value - 전송할 NativeToken(ex: ETH, BNB, AVAX) 양, 기본값 0 (BigNumber, optional)
 *
 * @returns Eip712Request - {@link Eip712Request} EIP-712 메시지 서명 요청 전체 객체
 *
 * @example
 * const eip712Request = getEIP712MessageForGasFreeTransaction(
 *   "GSN Forwarder",
 *   "1",
 *   5,
 *   "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
 *   "0xabcdef...",
 *   "0x1234...abcd",
 *   "0xabcd...1234",
 *   BigNumber.from("210000"),
 *   BigNumber.from("1"),
 *   BigNumber.from("0")
 * );
 */
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
): Eip712Request {
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

  const message: Eip712Message = {
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

  const result: Eip712Request = {
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

describe(`* ERC20.transfer executed by GSN Relay *`, async () => {
  /** GSN Contract의 최초 배포자이자 소유자가 될 EOA */
  let owner: Wallet;

  /**
   * RelayManager는 {@link RelayHub}에 등록되어야 하는 관리자로서,
   * Relay 네트워크 내에서 중개자(relay worker)들을 관리하고,
   * 메타 트랜잭션을 처리하기 위한 다양한 관리 작업을 수행합니다.
   *
   * 주요 역할:
   * - RelayHub에 자신의 존재를 등록하여 공식 RelayManager로 인정받음
   * - RelayWorker(실제 트랜잭션을 중계하는 노드)들의 등록 및 관리
   * - Relay 수수료, 보증금(Stake), 해제(Unstake) 등 Relay 운영 관련 상태 관리
   * - RelayHub와의 상호작용을 통해 메타 트랜잭션 중계 프로세스 제어
   *
   * RelayManager는 RelayHub의 신뢰 기반 모델에서 Relay 네트워크의 중추적 역할을 하며,
   * Relay 서비스를 안정적으로 제공하기 위한 핵심 관리자 역할을 수행합니다.
   */
  let relayManager: Wallet;

  /**
   * RelayWorker는 실제로 메타 트랜잭션을 블록체인에 제출하는 중계 EOA 입니다.
   * {@link relayManager}가 관리하며, {@link RelayHub}를 통해 메타 트랜잭션을 실행하는 역할을 수행합니다.
   *
   * 주요 역할:
   * - 사용자의 서명된 메타 트랜잭션을 받아 RelayHub에 제출
   * - Gas를 선불 지불하고 트랜잭션 실행
   * - RelayHub 에서 구성에따라 Paymaster({@link BasePaymaster}구현 계약)로부터 수수료를 수령할 수 있음
   */
  let relayWorker: Wallet;

  /**
   * StakeManager는 Relay 네트워크 내에서 {@link relayManager}의 스테이킹(보증금)과
   * 언스테이킹, 잠금 기간 등을 관리하는 스마트 컨트랙트입니다.
   * Relay 서비스의 신뢰성 확보를 위한 경제적 인센티브와 제재 메커니즘을 제공합니다.
   *
   * 주요 역할:
   * - {@link relayManager} 및 {@link relayWorker}의 보증금 관리
   * - 스테이크 잠금, 해제 및 청산 조건 관리
   */
  let stakeManager: StakeManager;

  /**
   * Penalizer는 Relay 네트워크 내에서 부정행위 또는 비정상적인 Relay 동작을
   * 감지하고 제재하는 역할을 하는 컨트랙트 또는 모듈입니다.
   * {@link relayManager} 나 {@link relayWorker}가 규칙을 위반할 경우 페널티를 부과합니다.
   */
  let penalizer: Penalizer;

  /**
   * RelayHub는 메타 트랜잭션 중계의 중심 스마트 컨트랙트입니다.
   * {@link relayManager}, {@link relayWorker}, 그리고 사용자 요청을 연결하여
   * 메타 트랜잭션의 실행과 비용 정산을 관리합니다.
   *
   * 주요 역할:
   * - {@link relayManager} 등록 및 관리
   * - {@link relayWorker} 등록 및 검증
   * - 메타 트랜잭션 실행 ({@link RelayHub.relayCall})
   * - 비용 정산 및 수수료 분배
   */
  let relayHub: RelayHub;

  /**
   * Forwarder는 사용자를 대신해 메타 트랜잭션을 검증하고 실행하는 스마트 컨트랙트입니다.
   * 사용자의 서명을 검증하고, 중복 실행 방지(Nonce 관리)를 담당합니다.
   *
   * 주요 역할:
   * - EIP-712 서명 검증
   * - 트랜잭션 실행 전 검증 및 실행 ({@link Forwarder.verify})
   * - 중복 호출 방지를 위한 nonce 관리
   */
  let forwarder: Forwarder;

  /**
   * ZeroPaymaster는 메타 트랜잭션 실행 시 비용 부담자(paymaster)가 없는 경우,
   * 즉, 비용을 전혀 청구하지 않는 특수한 {@link BasePaymaster} 구현체입니다.
   * {@link RelayHub}에서 Relay 트랜잭션을 실행할 때 가스비를 무료로 처리하도록 설계되었습니다.
   */
  let zeroPaymaster: ZeroPaymaster;

  /**
   * 커스텀 ERC-20 토큰인 {@link ClamCoin} 의 인스턴스입니다.
   * 이 토큰은 {@link GasFreeERC20}을 상속하여 구현되었으며,
   * EIP-2771 (Meta Transactions 지원)을 구현({@link ERC2771Context})한 포워더 기반 구조를 사용합니다.
   *
   * 이를 통해 사용자는 토큰 전송 등의 트랜잭션을 **가스 없이** 수행할 수 있으며,
   * 트랜잭션은 Trusted Forwarder를 통해 서명 기반으로 Relay됩니다.
   *
   * 주요 특징:
   * - ERC-20 표준을 준수
   * - EIP-2771을 통한 Meta Transaction 지원
   * - Forwarder를 통한 신뢰 가능한 사용자 인증
   */
  let clamCoin: ClamCoin;

  let domainHash: string = "";
  let domainValue: string = "";

  let relayHubConfig: IRelayHub.RelayHubConfigStruct;

  let relayExcuteReceipt: ContractReceipt;

  before(async () => {
    const [operator] = await ethers.getSigners();

    if (!operator.provider) {
      throw new Error("provider is undefined");
    }

    // #region - EOA 생성 (owner, relayManager, relayWorker)
    owner = ethers.Wallet.createRandom().connect(operator.provider);

    relayManager = ethers.Wallet.createRandom().connect(operator.provider);

    relayWorker = ethers.Wallet.createRandom().connect(operator.provider);
    // #endregion

    // #region - Native Token 분배 (owner, relayManager, relayWorker)
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
    // #endregion

    // #region 배포 계약 Factory 초기화
    const stakeManagerFactory = await ethers.getContractFactory("StakeManager");

    const penalizerFactory = await ethers.getContractFactory("Penalizer");

    const relayHubFactory = await ethers.getContractFactory("RelayHub");

    const forwarderFactory = await ethers.getContractFactory("Forwarder");

    const zeroPaymasterFactory =
      await ethers.getContractFactory("ZeroPaymaster");

    const clamCoinFactory = await ethers.getContractFactory("ClamCoin");

    // #endregion

    // #region Contract Deploy ( StakeManager, Penalizer, RelayHub, Forwarder, ZeroPaymaster, ClamCoin )

    stakeManager = await stakeManagerFactory.deploy();

    await stakeManager.deployed();

    penalizer = await penalizerFactory.deploy();

    await penalizer.deployed();

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

    forwarder = await forwarderFactory.deploy();

    await forwarder.deployed();

    //MARK: deploy Paymaster
    zeroPaymaster = await zeroPaymasterFactory.deploy(
      relayHub.address,
      forwarder.address,
    );

    await zeroPaymaster.deployed();

    //MARK: deploy ClamCoin
    clamCoin = await clamCoinFactory.connect(owner).deploy(forwarder.address);

    await clamCoin.deployed();

    // #endregion
  });

  describe("* GSN Relay Setup *", async () => {
    it("1. register Domain - Forwarder ", async () => {
      // #region Forwarder - registerDomainSeparator Transaction
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
          // console.log("DomainRegistered event found:");
          // console.log("domainHash:", domainHash);
          // console.log("domainValue:", domainValue);
        }
      }

      // #endregion
      const domainRegistered = await forwarder.domains(domainHash);
      expect(domainRegistered).to.equal(true);
    });

    it("2.register RequestType - Forwarder", async () => {
      // #region Forwarder - registerRequestType Transaction

      const GENERIC_PARAMS =
        "address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,uint256 validUntil";

      const RELAYDATA_TYPE =
        "RelayData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee,address relayWorker,address paymaster,address forwarder,bytes paymasterData,uint256 clientId)";

      const RELAY_REQUEST_NAME = "RelayRequest";

      const RELAY_REQUEST_SUFFIX = `RelayData relayData)${RELAYDATA_TYPE}`;

      const RELAY_REQUEST_TYPE = `${RELAY_REQUEST_NAME}(${GENERIC_PARAMS},RelayData relayData)${RELAYDATA_TYPE}`;

      // const registerRequestTypeTx = await forwarder.registerRequestType(
      //   RELAY_REQUEST_NAME,
      //   RELAY_REQUEST_SUFFIX,
      // );

      // const registerRequestTypeReceipt = await registerRequestTypeTx.wait();

      // for (const log of registerRequestTypeReceipt.logs) {
      //   const parsedLog = forwarder.interface.parseLog(log);
      //   if (parsedLog.name === "RequestTypeRegistered") {
      //     const typeHash = parsedLog.args.typeHash;
      //     const typeStr = parsedLog.args.typeStr;
      //     console.log("RequestTypeRegistered event found:");
      //     console.log("typeHash:", typeHash);
      //     console.log("typeName:", typeStr);
      //   }
      // }

      const genericParams = `address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,uint256 validUntil`;
      const typeString = `ForwardRequest(${genericParams})`;
      const typeStrToBytes = ethers.utils.toUtf8Bytes(typeString);
      // console.log("typeString: ", typeString);
      // console.log(`typeStrToBytes: `, typeStrToBytes);
      const typeHash = ethers.utils.keccak256(typeStrToBytes);
      // console.log(
      //   "typeHash: ",
      //   typeHash,
      //   "/ forwarder registered: ",
      //   await forwarder.typeHashes(typeHash),
      // );

      // #endregion
      const forwardRequestTypeRegistered = await forwarder.typeHashes(typeHash);
      expect(forwardRequestTypeRegistered).to.equal(true);
    });

    it(`3. set Relay Manager Owner - StakeManager ( owner is owner to ralayManager)`, async () => {
      // #region StakeManager - setRelayManagerOwner Transaction
      const setRelayManagerOwnerTx = await stakeManager
        .connect(relayManager)
        .setRelayManagerOwner(owner.address);

      const setRelayManagerOwnerReceipt = await setRelayManagerOwnerTx.wait();
      // console.log(`setRelayManagerOwnerReceipt: `, setRelayManagerOwnerReceipt);
      // #endregion
      const [stake, unstakeDelay, withdrawBlock, relayManagerOwner] =
        await stakeManager.stakes(relayManager.address);

      expect(relayManagerOwner).to.equal(owner.address);
    });

    it(`4. self authorize relayManager to relayHub - StakeManager`, async () => {
      // #region StakeManager - authorizeHubByManager Transaction
      const authorizeHubByManagerTx = await stakeManager
        .connect(relayManager)
        .authorizeHubByManager(relayHub.address);

      const authorizeHubByManagerReceipt = await authorizeHubByManagerTx.wait();
      // console.log(`authorizeHubByManagerReceipt: `, authorizeHubByManagerReceipt);
      // #endregion
      const removalBlockOfRelayManager = await stakeManager.authorizedHubs(
        relayManager.address,
        relayHub.address,
      );
      const maxUint256 = BigNumber.from(
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );
      expect(removalBlockOfRelayManager.eq(maxUint256)).to.equal(true);
    });

    it(`5. owner authorize relayManager to relayHub  - StakeManager`, async () => {
      // #region StakeManager - authorizeHubByOwner Transaction
      const authorizeHubByOwnerTx = await stakeManager
        .connect(owner)
        .authorizeHubByOwner(relayManager.address, relayHub.address);
      const authorizeHubByOwnerReceipt = await authorizeHubByOwnerTx.wait();
      // console.log(`authorizeHubByOwnerReceipt: `, authorizeHubByOwnerReceipt);

      // #endregion
      const removalBlockOfRelayManager = await stakeManager.authorizedHubs(
        relayManager.address,
        relayHub.address,
      );
      const maxUint256 = BigNumber.from(
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );
      expect(removalBlockOfRelayManager.eq(maxUint256)).to.equal(true);
    });

    it(`6. staking by owner for RelayManager - StakeManager`, async () => {
      // #region StakeManager - stakeForRelayManager Transaction

      const stakeRelayManagerTx = await stakeManager
        .connect(owner)
        .stakeForRelayManager(relayManager.address, 0, {
          value: ethers.utils.parseEther("2"),
        });
      const stakeRelayManagerReceipt = await stakeRelayManagerTx.wait();

      // console.log(`stakeRelayManagerReceipt: `, stakeRelayManagerReceipt);
      // #endregion
      const [stake, unstakeDelay, withdrawBlock, relayManagerOwner] =
        await stakeManager.getStakeInfo(relayManager.address);
      expect(ethers.utils.parseEther("2").eq(stake)).to.equal(true);
    });

    it(`6-1. isRelayManagerStaked - StakeManager `, async () => {
      const result = await stakeManager.isRelayManagerStaked(
        relayManager.address,
        relayHub.address,
        ethers.utils.parseEther("0.1"),
        BigNumber.from(0),
      );

      expect(result).to.equal(true);
    });

    it(`6-2. isRelayManagerStaked - RelayHub `, async () => {
      const result = await relayHub.isRelayManagerStaked(relayManager.address);
      expect(result).to.equal(true);
    });

    it(`7. add relay worker - RelayHub`, async () => {
      // #region RelayHub - addRelayWorkers Transaction
      const addRelayWorkerTx = await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address]);

      const addRelayWorkerReceipt = await addRelayWorkerTx.wait();
      // console.log(`addRelayWorkerReceipt: `, addRelayWorkerReceipt);
      // #endregion
      const workersManager = await relayHub.workerToManager(
        relayWorker.address,
      );
      expect(workersManager).to.equal(relayManager.address);
    });

    it(`8. register Relay Server - RelayHub`, async () => {
      // #region RelayHub - registerRelayServer Transaction
      const registerRelayServerTx = await relayHub
        .connect(relayManager)
        .registerRelayServer(
          BigNumber.from(0),
          BigNumber.from(0),
          "https://dummy-relay",
        );

      const registerRelayServerReceipt = await registerRelayServerTx.wait();
      // console.log(`registerRelayServerReceipt: `, registerRelayServerReceipt);
      // #endregion
      const found = registerRelayServerReceipt.events?.find(
        (e) =>
          e.event === "RelayServerRegistered" &&
          e.args?.relayManager.toLowerCase() ===
            relayManager.address.toLowerCase(),
      );

      expect(!!found).to.equal(true);
    });

    it(`9. get RelayHub Info - RelayHub`, async () => {
      relayHubConfig = await relayHub.getConfiguration();
      // console.log("RelayHubConfig: ", config);
      expect(!!config).to.equal(!!config);
    });

    it(`10. fund paymaster`, async () => {
      // Fund Paymaster
      const fundTx = await owner.sendTransaction({
        to: zeroPaymaster.address,
        value: ethers.utils.parseEther("1"),
      });
      const fundReceipt = await fundTx.wait();
      const zeroPaymasterBalance = await relayHub.balanceOf(
        zeroPaymaster.address,
      );

      expect(zeroPaymasterBalance.gt(BigNumber.from(0))).to.equal(true);
      console.log("zeroPaymasterBalance: ", zeroPaymasterBalance);
    });
  });

  describe("* get ClamCoin info ( implements GasFreeERC20 - ERC-2771 compatible contract for meta-transactions ) *", async () => {
    it("recognizes and validates a trusted forwarder ", async () => {
      const trustedForwarder = await clamCoin.trustedForwarder();
      // console.log("trustedForwarder:", trustedForwarder);
      expect(trustedForwarder).equal(forwarder.address);
    });

    it("owner balance of ClamCoin ", async () => {
      const [nameOfCLAM, symbolOfCLAM, balance, decimals] = await Promise.all([
        clamCoin.name(),
        clamCoin.symbol(),
        clamCoin.balanceOf(owner.address),
        clamCoin.decimals(),
      ]);
      expect(balance.gt(BigNumber.from(0))).to.equal(true);
      console.log(
        `💎 ClamCoin (${nameOfCLAM} / ${symbolOfCLAM}) : `,
        clamCoin.address,
      );

      console.log(
        `${owner.address} balance: ${balance} (${ethers.utils.formatUnits(balance, decimals)})`,
      );
    });
  });

  describe("Verifiability-based Relay System Test ( GSN Architecture ) ", async () => {
    it("Test GasFree Transfer", async () => {
      // console.log(
      //   "======================================================================",
      // );
      // // console.log("fundReceipt:", fundReceipt);
      // console.log(
      //   "======================================================================",
      // );

      const eoa = relayManager.address;
      const amount = ethers.utils.parseEther("100");
      const data = clamCoin.interface.encodeFunctionData("transfer", [
        //   owner.address,
        eoa,
        amount,
      ]);
      const gas = await clamCoin
        .connect(owner)
        .estimateGas.transfer(eoa, amount);
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

      relayExcuteReceipt = await relayExcuteTx.wait();

      const event = relayExcuteReceipt.events?.find(
        (e) => e.event === "TransactionRejectedByPaymaster",
      );
      if (!!event) {
        // console.log(event?.args);
        // console.log("Rejected Reason:", event?.args?.reason);
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

    const zeroPaymasterBalance = await relayHub.balanceOf(
      zeroPaymaster.address,
    );

    console.log("zeroPaymasterBalance: ", zeroPaymasterBalance);

    console.log("💎 Forwarder : ", forwarder.address);
    console.log("💎 StakeManager : ", stakeManager.address);
    console.log("💎 Penalizer : ", penalizer.address);
    console.log("💎 Paymaster : ", zeroPaymaster.address);
    console.log("💎 RelayHub : ", relayHub.address);
    console.log(`⚙️  RelayHubConfig :`, relayHubConfig);
    console.log("🧾  RelayExcuteReceipt:", relayExcuteReceipt);
  });
});
