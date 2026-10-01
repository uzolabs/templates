// Deploys UzoNFT with Foundry (default) or Hardhat Ignition (--tool hardhat).
//
//   npm run deploy                     Foundry, testnet
//   npm run deploy:hardhat             Hardhat Ignition, testnet
//   npm run deploy -- --mainnet        Foundry, mainnet (asks you to type MAINNET)
//
// Afterwards it writes the address to deployments/<chainId>.json and frontend/.env,
// and prints the BOTScan link and the verify command.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { formatEther, getAddress, parseEther, type Hex } from "viem"
import {
  assertChain,
  assertHasGas,
  confirmMainnet,
  fail,
  getClients,
  getNetwork,
  getPrivateKey,
  loadEnv,
} from "./lib/network.js"
import {
  printDeploySummary,
  readForgeAbi,
  run,
  runHardhat,
  saveDeployment,
  updateFrontendEnv,
} from "./lib/deployments.js"
import { exportAbi } from "./export-abi.js"

const CONTRACT = "UzoNFT"
const SOURCE = "contracts/UzoNFT.sol:UzoNFT"

loadEnv()
const tool = process.argv.includes("hardhat") ? "hardhat" : "foundry"
const net = getNetwork()
const key = getPrivateKey()
const { account } = getClients(net, key)
const deployer = account!.address

// Constructor arguments. The Foundry script and Ignition module read the same variables
// with the same defaults; they are passed explicitly here so the record matches exactly.
const name = process.env.NFT_NAME || "Uzo NFT"
const symbol = process.env.NFT_SYMBOL || "UZONFT"
const priceText = process.env.NFT_MINT_PRICE || "0.01"
const maxSupplyText = process.env.NFT_MAX_SUPPLY || "1000"
if (!/^\d+(\.\d{1,18})?$/.test(priceText))
  fail(`NFT_MINT_PRICE must be an amount of BOT such as 0.01, got "${priceText}".`)
if (!/^[1-9]\d*$/.test(maxSupplyText)) fail(`NFT_MAX_SUPPLY must be a whole number above zero, got "${maxSupplyText}".`)
const mintPrice = parseEther(priceText)
const maxSupply = BigInt(maxSupplyText)
const constructorArgs = [name, symbol, mintPrice.toString(), maxSupply.toString(), deployer]

await assertChain(net)
const balance = await assertHasGas(net, deployer)
const coin = net.chain.nativeCurrency.symbol
console.log(
  `Deploying ${CONTRACT} to ${net.chain.name} (chain ${net.chain.id}) with ${tool === "hardhat" ? "Hardhat Ignition" : "Foundry"}`,
)
console.log(`  Deployer: ${deployer} (${formatEther(balance)} ${coin})`)
console.log(`  NFT:      ${name} (${symbol}), ${formatEther(mintPrice)} ${coin} per mint, at most ${maxSupply}`)
await confirmMainnet(net, `deploy ${CONTRACT}`)

// forge cannot read "0.01" as ether, so the Foundry script gets the price in wei.
const nftEnv = {
  NFT_NAME: name,
  NFT_SYMBOL: symbol,
  NFT_MINT_PRICE_WEI: mintPrice.toString(),
  NFT_MAX_SUPPLY: maxSupplyText,
}
let address: Hex
let txHash: Hex | undefined

if (tool === "foundry") {
  run("forge", ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", net.rpcUrl, "--broadcast"], nftEnv)
  // forge writes what it sent to broadcast/<script>/<chainId>/run-latest.json
  const broadcast = JSON.parse(
    readFileSync(path.join("broadcast", "Deploy.s.sol", String(net.chain.id), "run-latest.json"), "utf8"),
  )
  const tx = broadcast.transactions.find((t: any) => t.transactionType === "CREATE" && t.contractName === CONTRACT)
  address = getAddress(tx.contractAddress)
  txHash = tx.hash
} else {
  run("forge", ["build"]) // the frontend ABI export below reads forge's output
  const deploymentId = `chain-${net.chain.id}-${Date.now()}`
  mkdirSync("ignition", { recursive: true })
  const paramsFile = path.join("ignition", "parameters.local.json")
  writeFileSync(
    paramsFile,
    JSON.stringify({ UzoNFTModule: { name, symbol, mintPrice: `${mintPrice}n`, maxSupply: `${maxSupply}n` } }, null, 2),
  )
  runHardhat(
    [
      "ignition",
      "deploy",
      "ignition/modules/UzoNFT.ts",
      "--network",
      net.hardhatNetwork,
      "--parameters",
      paramsFile,
      "--deployment-id",
      deploymentId,
    ],
    // We already asked for confirmation above (typed, on mainnet), so skip Ignition's own y/n prompt.
    { HARDHAT_IGNITION_CONFIRM_DEPLOYMENT: "true" },
  )
  const dir = path.join("ignition", "deployments", deploymentId)
  const deployed = JSON.parse(readFileSync(path.join(dir, "deployed_addresses.json"), "utf8"))
  address = getAddress(deployed[`UzoNFTModule#${CONTRACT}`])
  txHash = findIgnitionTxHash(path.join(dir, "journal.jsonl"))
}

const { publicClient } = getClients(net)
const code = await publicClient.getCode({ address })
if (!code || code === "0x")
  console.warn(`Warning: no code found at ${address} yet. The RPC may be lagging; check BOTScan.`)

const record = {
  contract: CONTRACT,
  source: SOURCE,
  address,
  chainId: net.chain.id,
  txHash,
  deployer,
  constructorArgs,
  tool,
  deployedAt: new Date().toISOString(),
} as const
saveDeployment(record)
updateFrontendEnv({ VITE_CONTRACT_ADDRESS: address, VITE_CHAIN_ID: String(net.chain.id) })
exportAbi(readForgeAbi(CONTRACT))

const flag = net.isMainnet ? " -- --mainnet" : ""
printDeploySummary(net, record, tool === "hardhat" ? `npm run verify:hardhat${flag}` : `npm run verify${flag}`)
console.log("Next: npm run mint, then npm run frontend")

function findIgnitionTxHash(journalFile: string): Hex | undefined {
  try {
    for (const line of readFileSync(journalFile, "utf8").split("\n")) {
      if (!line.includes("TRANSACTION_SEND")) continue
      const entry = JSON.parse(line)
      if (entry.transaction?.hash) return entry.transaction.hash
    }
  } catch {
    // The hash is only used for the printed link, so a missing journal is not fatal.
  }
  return undefined
}
