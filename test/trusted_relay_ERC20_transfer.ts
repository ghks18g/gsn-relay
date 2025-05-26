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
  /** Forwarder Contract의 최초 배포자이자 소유자가 될 EOA */
  let owner: Wallet;

  /**
   * RelayWorker는 실제로 메타 트랜잭션을 블록체인에 제출하는 중계 EOA 입니다.
   * {@link Forwarder}를 통해 메타 트랜잭션을 실행하는 역할을 수행합니다.
   *
   * 주요 역할:
   * - 사용자의 서명된 메타 트랜잭션을 받아 Forwarder에 제출
   * - Gas를 선불 지불하고 트랜잭션 실행
   */
  let relayWorker: Wallet;

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

  let forwarderExcuteReceipt: ContractReceipt;

  before(async () => {
    const [operator] = await ethers.getSigners();

    if (!operator.provider) {
      throw new Error("provider is undefined");
    }

    // #region - EOA 생성 (owner, relayWorker)
    owner = ethers.Wallet.createRandom().connect(operator.provider);

    relayWorker = ethers.Wallet.createRandom().connect(operator.provider);
    // #endregion

    // #region - Native Token 분배 (owner, relayWorker)
    const sendNativeToOwner = await operator.sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther("1000"),
    });

    await sendNativeToOwner.wait();

    const sendNativeToRelayWorker = await operator.sendTransaction({
      to: relayWorker.address,
      value: ethers.utils.parseEther("1000"),
    });

    await sendNativeToRelayWorker.wait();
    // #endregion

    // #region 배포 계약 Factory 초기화

    const forwarderFactory = await ethers.getContractFactory("Forwarder");

    const clamCoinFactory = await ethers.getContractFactory("ClamCoin");

    // #endregion

    // #region Contract Deploy ( Forwarder, ClamCoin )

    forwarder = await forwarderFactory.deploy();

    await forwarder.deployed();

    //MARK: deploy ClamCoin
    clamCoin = await clamCoinFactory.connect(owner).deploy(forwarder.address);

    await clamCoin.deployed();

    // #endregion
  });

  describe("* Forwarder Setup *", async () => {
    it("1. register Domain - Forwarder ", async () => {
      // #region Forwarder - registerDomainSeparator Transaction
      const registerDomainSeparatorTx = await forwarder.registerDomainSeparator(
        "Trusted Relay Transaction",
        "1",
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

  describe("Trusted Relay System Test ( Off chain verification + Forwarder Direct Call ) ", async () => {
    it("test Gas Free Transfer2: ", async () => {
      const eoa = relayWorker.address;
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
        "Trusted Relay Transaction",
        "1",
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
      const genericParams = `address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,uint256 validUntil`;
      const typeString = `ForwardRequest(${genericParams})`;
      const typeStrToBytes = ethers.utils.toUtf8Bytes(typeString);
      // console.log("typeString: ", typeString);
      // console.log(`typeStrToBytes: `, typeStrToBytes);
      const typeHash = ethers.utils.keccak256(typeStrToBytes);

      console.log(
        `before ${owner.address} balanceOf ClaimCoin : `,
        await clamCoin.balanceOf(owner.address),
      );

      const trustedRelayTx = await forwarder.connect(relayWorker).execute(
        {
          ...eip712Request.message,
        },
        domainHash,
        typeHash,
        ethers.utils.toUtf8Bytes(""),
        signature,
      );

      forwarderExcuteReceipt = await trustedRelayTx.wait();

      console.log(
        `after ${owner.address} balanceOf ClaimCoin : `,
        await clamCoin.balanceOf(owner.address),
      );
    });
  });

  after(async () => {
    const ownerNative = await owner.getBalance();
    const ownerCLAM = await clamCoin.balanceOf(owner.address);

    const relayWorkerNative = await relayWorker.getBalance();
    const relayWorkerCLAM = await clamCoin.balanceOf(relayWorker.address);

    console.log(`-------------------- ${owner.address} --------------------`);
    console.log(
      `\tNative : ${ownerNative} / (${ethers.utils.formatEther(ownerNative)})`,
    );
    console.log(
      `\tCLAM : ${ownerCLAM} / (${ethers.utils.formatEther(ownerCLAM)})`,
    );

    console.log(
      `-------------------- ${relayWorker.address} --------------------`,
    );
    console.log(
      `\tNative : ${relayWorkerNative} / (${ethers.utils.formatEther(relayWorkerNative)})`,
    );
    console.log(
      `\tCLAM : ${relayWorkerCLAM} / (${ethers.utils.formatEther(relayWorkerCLAM)})`,
    );

    console.log("💎 Forwarder : ", forwarder.address);

    console.log("🧾  ForwarderExcuteReceipt:", forwarderExcuteReceipt);
  });
});
