import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-truffle5";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-ethers";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import "solidity-coverage";

dotenv.config();

const config: HardhatUserConfig = {
  // solidity: "0.8.28",
  solidity: {
    compilers: [
      {
        version: "0.8.22",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "london",
        },
      },
    ],
  },
  networks: {
    hardhat: {
      accounts: { count: 1000 },
    },
    sepolia: {
      chainId: 11155111,
      url: `https://rpc.ankr.com/eth_sepolia`,
      accounts: [process.env.OPERATOR_KEY || ""],
    },
    bscTestnet: {
      chainId: 97,
      url: `https://data-seed-prebsc-1-s1.binance.org:8545/`,
      accounts: [process.env.OPERATOR_KEY || ""],
    },
    avalancheFuji: {
      chainId: 43113,
      url: `https://api.avax-test.network/ext/bc/C/rpc`,
      accounts: [process.env.OPERATOR_KEY || ""],
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "sepolia",
        chainId: 11155111,
        urls: {
          apiURL: "",
          browserURL: "https://testnet.etherscan.io/",
        },
      },
      {
        network: "bscTestnet",
        chainId: 97,
        urls: {
          apiURL: "",
          browserURL: "https://testnet.bscscan.com/",
        },
      },
      {
        network: "avalancheFuji",
        chainId: 43113,
        urls: {
          apiURL: "",
          browserURL: "https://testnet.avascan.info/",
        },
      },
    ],
  },
  mocha: {
    timeout: 20000, // 20초
    bail: false, // 첫 실패에서 멈추지 않음
    parallel: false, // 병렬 실행 비활성화 (기본은 false)
  },
};

export default config;
