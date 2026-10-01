// Hardhat 3 config shared by every Uzo template.
// Maintainers: this file is copied from _shared/hardhat.config.base.ts. Edit it there, then run `npm run sync`.
import { existsSync } from "node:fs"
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem"
import { configVariable, defineConfig } from "hardhat/config"
import { botChain, botChainTestnet } from "@uzolabs/sdk/chains"

// Hardhat does not read .env on its own. Load it so PRIVATE_KEY and RPC overrides work.
if (existsSync(".env")) process.loadEnvFile(".env")

// BOTScan is a Blockscout instance. Verification uses its Etherscan-compatible /api endpoint.
const explorer = (chain: typeof botChain | typeof botChainTestnet) => ({
  name: chain.blockExplorers.default.name,
  url: chain.blockExplorers.default.url,
  apiUrl: `${chain.blockExplorers.default.url}/api`,
})

export default defineConfig({
  plugins: [
    hardhatToolboxViemPlugin,
    // Fills in the fee Ignition leaves at 0 on BOT Chain. See scripts/lib/ignition-fees.ts.
    { id: "uzo-ignition-fees", hookHandlers: { network: () => import("./scripts/lib/ignition-fees.js") } },
  ],
  paths: {
    sources: "./contracts",
    tests: { solidity: "./test" },
  },
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    botTestnet: {
      type: "http",
      chainType: "l1",
      chainId: botChainTestnet.id,
      url: process.env.BOT_TESTNET_RPC_URL || botChainTestnet.rpcUrls.default.http[0],
      accounts: [configVariable("PRIVATE_KEY")],
    },
    botMainnet: {
      type: "http",
      chainType: "l1",
      chainId: botChain.id,
      url: process.env.BOT_MAINNET_RPC_URL || botChain.rpcUrls.default.http[0],
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
  chainDescriptors: {
    [botChainTestnet.id]: {
      name: botChainTestnet.name,
      blockExplorers: { blockscout: explorer(botChainTestnet) },
    },
    [botChain.id]: {
      name: botChain.name,
      blockExplorers: { blockscout: explorer(botChain) },
    },
  },
})
