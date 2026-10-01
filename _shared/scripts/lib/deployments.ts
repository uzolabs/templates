// Deployment records, frontend .env updates and child-process helpers.
// Maintainers: this file is copied from _shared/scripts/lib/deployments.ts. Edit it there, then run `npm run sync`.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { botChain } from "@uzolabs/sdk/chains"
import { encodeAbiParameters, type Abi, type AbiParameter, type Address, type Hex } from "viem"
import { addressUrl, fail, txUrl, type NetworkInfo } from "./network.js"

export interface DeploymentRecord {
  contract: string
  /** Fully qualified name used by forge verify-contract, for example contracts/UzoToken.sol:UzoToken */
  source: string
  address: Address
  chainId: number
  txHash?: Hex
  deployer: Address
  /** Constructor arguments as JSON-safe strings (bigints become decimal strings). */
  constructorArgs: string[]
  tool: "foundry" | "hardhat"
  deployedAt: string
}

const deploymentsFile = (chainId: number) => path.join("deployments", `${chainId}.json`)

export function readDeployments(chainId: number): Record<string, DeploymentRecord> {
  const file = deploymentsFile(chainId)
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
}

export function getDeployment(chainId: number, contract: string): DeploymentRecord {
  const record = readDeployments(chainId)[contract]
  if (!record) {
    fail(
      `No ${contract} deployment found for chain ${chainId} in ${deploymentsFile(chainId)}.`,
      chainId === botChain.id ? "Deploy first with: npm run deploy -- --mainnet" : "Deploy first with: npm run deploy",
    )
  }
  return record
}

export function saveDeployment(record: DeploymentRecord): void {
  mkdirSync("deployments", { recursive: true })
  const all = readDeployments(record.chainId)
  all[record.contract] = record
  writeFileSync(deploymentsFile(record.chainId), `${JSON.stringify(all, null, 2)}\n`)
}

/** Sets keys in frontend/.env, keeping any other lines the user added. */
export function updateFrontendEnv(values: Record<string, string>): void {
  if (!existsSync("frontend")) return
  const file = path.join("frontend", ".env")
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : []
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`))
    if (index >= 0) lines[index] = `${key}=${value}`
    else lines.push(`${key}=${value}`)
  }
  writeFileSync(file, `${lines.filter((line) => line.trim() !== "").join("\n")}\n`)
}

/** Reads the ABI that `forge build` wrote to out/<File>.sol/<Contract>.json. */
export function readForgeAbi(contract: string, file = `${contract}.sol`): Abi {
  const artifact = path.join("out", file, `${contract}.json`)
  if (!existsSync(artifact)) fail(`Missing ${artifact}.`, "Run `npm run build` first.")
  return JSON.parse(readFileSync(artifact, "utf8")).abi as Abi
}

/** ABI-encodes constructor arguments, as forge verify-contract expects them. */
export function encodeConstructorArgs(abi: Abi, args: string[]): Hex {
  const ctor = abi.find((item) => item.type === "constructor")
  if (!ctor || ctor.type !== "constructor" || ctor.inputs.length === 0) return "0x"
  const values = ctor.inputs.map((input: AbiParameter, i) =>
    /^u?int\d*$/.test(input.type) ? BigInt(args[i]!) : args[i],
  )
  return encodeAbiParameters(ctor.inputs, values)
}

/** Runs a command with inherited output and stops the script if it fails. */
export function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
  const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, ...env } })
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    fail(
      `Could not find \`${command}\`.`,
      command === "forge"
        ? "Install Foundry (https://getfoundry.sh), open a new terminal, and check that `forge --version` works."
        : `Install ${command} and try again.`,
    )
  }
  if (result.status !== 0) fail(`\`${command} ${args.join(" ")}\` failed (exit code ${result.status}).`)
}

/** Runs the project's local Hardhat without relying on npx (which needs a shell on Windows). */
export function runHardhat(args: string[], env: NodeJS.ProcessEnv = {}): void {
  const require = createRequire(path.resolve("package.json"))
  const pkgPath = require.resolve("hardhat/package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.hardhat
  run(process.execPath, [path.join(path.dirname(pkgPath), bin), ...args], env)
}

export function printDeploySummary(net: NetworkInfo, record: DeploymentRecord, verifyCommand: string): void {
  console.log("")
  console.log(`${record.contract} deployed on ${net.chain.name} (chain ${record.chainId})`)
  console.log(`  Address:  ${record.address}`)
  console.log(`  BOTScan:  ${addressUrl(net, record.address)}`)
  if (record.txHash) console.log(`  Tx:       ${txUrl(net, record.txHash)}`)
  console.log(`  Saved to: deployments/${record.chainId}.json and frontend/.env`)
  console.log("")
  console.log("Verify the source code on BOTScan (wait about a minute for the explorer to index it first):")
  console.log(`  ${verifyCommand}`)
  console.log("")
}
