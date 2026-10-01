// Deploys UzoForwarder and GuestBook with Foundry (default) or Hardhat Ignition (--tool hardhat).
//
//   npm run deploy                     Foundry, testnet
//   npm run deploy:hardhat             Hardhat Ignition, testnet
//   npm run deploy -- --mainnet        Foundry, mainnet (asks you to type MAINNET)
//
// Afterwards it writes both addresses to deployments/<chainId>.json and frontend/.env,
// and prints the BOTScan links and the verify command.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { formatEther, getAddress, type Hex } from "viem"
import {
  assertChain,
  assertHasGas,
  confirmMainnet,
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
  type DeploymentRecord,
} from "./lib/deployments.js"
import { exportAbi } from "./export-abi.js"

const MODULE = "GuestBookModule"

loadEnv()
const tool = process.argv.includes("hardhat") ? "hardhat" : "foundry"
const net = getNetwork()
const key = getPrivateKey()
const { account } = getClients(net, key)
const deployer = account!.address

await assertChain(net)
const balance = await assertHasGas(net, deployer)
console.log(
  `Deploying UzoForwarder and GuestBook to ${net.chain.name} (chain ${net.chain.id}) with ${tool === "hardhat" ? "Hardhat Ignition" : "Foundry"}`,
)
console.log(`  Deployer: ${deployer} (${formatEther(balance)} ${net.chain.nativeCurrency.symbol})`)
await confirmMainnet(net, "deploy UzoForwarder and GuestBook")

const deployed: Record<"UzoForwarder" | "GuestBook", { address: Hex; txHash?: Hex }> = {} as never

if (tool === "foundry") {
  run("forge", ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", net.rpcUrl, "--broadcast"])
  // forge writes what it sent to broadcast/<script>/<chainId>/run-latest.json
  const broadcast = JSON.parse(
    readFileSync(path.join("broadcast", "Deploy.s.sol", String(net.chain.id), "run-latest.json"), "utf8"),
  )
  for (const name of ["UzoForwarder", "GuestBook"] as const) {
    const tx = broadcast.transactions.find((t: any) => t.transactionType === "CREATE" && t.contractName === name)
    deployed[name] = { address: getAddress(tx.contractAddress), txHash: tx.hash }
  }
} else {
  run("forge", ["build"]) // the frontend ABI export below reads forge's output
  const deploymentId = `chain-${net.chain.id}-${Date.now()}`
  runHardhat(
    [
      "ignition",
      "deploy",
      "ignition/modules/GuestBook.ts",
      "--network",
      net.hardhatNetwork,
      "--deployment-id",
      deploymentId,
    ],
    // We already asked for confirmation above (typed, on mainnet), so skip Ignition's own y/n prompt.
    { HARDHAT_IGNITION_CONFIRM_DEPLOYMENT: "true" },
  )
  const dir = path.join("ignition", "deployments", deploymentId)
  const addresses = JSON.parse(readFileSync(path.join(dir, "deployed_addresses.json"), "utf8"))
  const hashes = ignitionTxHashes(path.join(dir, "journal.jsonl"))
  for (const name of ["UzoForwarder", "GuestBook"] as const) {
    const futureId = `${MODULE}#${name}`
    deployed[name] = { address: getAddress(addresses[futureId]), txHash: hashes[futureId] }
  }
}

const { publicClient } = getClients(net)
for (const { address } of Object.values(deployed)) {
  const code = await publicClient.getCode({ address })
  if (!code || code === "0x")
    console.warn(`Warning: no code found at ${address} yet. The RPC may be lagging; check BOTScan.`)
}

const records: DeploymentRecord[] = [
  {
    contract: "UzoForwarder",
    source: "contracts/UzoForwarder.sol:UzoForwarder",
    address: deployed.UzoForwarder.address,
    constructorArgs: [],
    txHash: deployed.UzoForwarder.txHash,
    chainId: net.chain.id,
    deployer,
    tool,
    deployedAt: new Date().toISOString(),
  },
  {
    contract: "GuestBook",
    source: "contracts/GuestBook.sol:GuestBook",
    address: deployed.GuestBook.address,
    constructorArgs: [deployed.UzoForwarder.address],
    txHash: deployed.GuestBook.txHash,
    chainId: net.chain.id,
    deployer,
    tool,
    deployedAt: new Date().toISOString(),
  },
]
for (const record of records) saveDeployment(record)

const frontendEnv: Record<string, string> = {
  VITE_CONTRACT_ADDRESS: deployed.GuestBook.address,
  VITE_FORWARDER_ADDRESS: deployed.UzoForwarder.address,
  VITE_CHAIN_ID: String(net.chain.id),
}
// Point the app at the local relayer, unless you already set VITE_RELAYER_URL to a hosted one.
const envFile = path.join("frontend", ".env")
if (!existsSync(envFile) || !/^VITE_RELAYER_URL=/m.test(readFileSync(envFile, "utf8")))
  frontendEnv.VITE_RELAYER_URL = `http://localhost:${process.env.RELAYER_PORT || "8787"}`
updateFrontendEnv(frontendEnv)
exportAbi(readForgeAbi("GuestBook"), readForgeAbi("UzoForwarder"))

const flag = net.isMainnet ? " -- --mainnet" : ""
const verifyCmd = tool === "hardhat" ? `npm run verify:hardhat${flag}` : `npm run verify${flag}`
records.forEach((record, i) => printDeploySummary(net, record, i === records.length - 1 ? verifyCmd : ""))
console.log(`Next: npm run relayer${flag} (in its own terminal), then npm run frontend`)

/** Maps each Ignition future id to the hash of the transaction that deployed it. */
function ignitionTxHashes(journalFile: string): Record<string, Hex> {
  const hashes: Record<string, Hex> = {}
  try {
    for (const line of readFileSync(journalFile, "utf8").split("\n")) {
      if (!line.includes("TRANSACTION_SEND")) continue
      const entry = JSON.parse(line)
      if (entry.futureId && entry.transaction?.hash) hashes[entry.futureId] = entry.transaction.hash
    }
  } catch {
    // The hashes are only used for the printed links, so a missing journal is not fatal.
  }
  return hashes
}
