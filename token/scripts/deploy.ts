// Deploys UzoToken with Foundry (default) or Hardhat Ignition (--tool hardhat).
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

const CONTRACT = "UzoToken"
const SOURCE = "contracts/UzoToken.sol:UzoToken"

loadEnv()
const tool = process.argv.includes("hardhat") ? "hardhat" : "foundry"
const net = getNetwork()
const key = getPrivateKey()
const { account } = getClients(net, key)
const deployer = account!.address

// Constructor arguments. The Foundry script and Ignition module read the same variables
// with the same defaults; they are passed explicitly here so the record matches exactly.
const name = process.env.TOKEN_NAME || "Uzo Token"
const symbol = process.env.TOKEN_SYMBOL || "UZO"
const supplyTokens = process.env.TOKEN_INITIAL_SUPPLY || "1000000"
if (!/^\d+$/.test(supplyTokens)) fail(`TOKEN_INITIAL_SUPPLY must be a whole number of tokens, got "${supplyTokens}".`)
const initialSupply = parseEther(supplyTokens)
const constructorArgs = [name, symbol, initialSupply.toString(), deployer]

await assertChain(net)
const balance = await assertHasGas(net, deployer)
console.log(
  `Deploying ${CONTRACT} to ${net.chain.name} (chain ${net.chain.id}) with ${tool === "hardhat" ? "Hardhat Ignition" : "Foundry"}`,
)
console.log(`  Deployer: ${deployer} (${formatEther(balance)} ${net.chain.nativeCurrency.symbol})`)
console.log(`  Token:    ${name} (${symbol}), initial supply ${formatEther(initialSupply)} to the deployer`)
await confirmMainnet(net, `deploy ${CONTRACT}`)

const tokenEnv = { TOKEN_NAME: name, TOKEN_SYMBOL: symbol, TOKEN_INITIAL_SUPPLY: supplyTokens }
let address: Hex
let txHash: Hex | undefined

if (tool === "foundry") {
  run("forge", ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", net.rpcUrl, "--broadcast"], tokenEnv)
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
    JSON.stringify({ UzoTokenModule: { name, symbol, initialSupply: `${initialSupply}n` } }, null, 2),
  )
  runHardhat(
    [
      "ignition",
      "deploy",
      "ignition/modules/UzoToken.ts",
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
  address = getAddress(deployed[`UzoTokenModule#${CONTRACT}`])
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
console.log("Next: npm run frontend")

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
