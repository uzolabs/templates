// Network selection and safety checks used by every script in this template.
// Maintainers: this file is copied from _shared/scripts/lib/network.ts. Edit it there, then run `npm run sync`.
import { existsSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { createPublicClient, createWalletClient, http, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { botChain, botChainTestnet } from "@uzolabs/sdk/chains"

export type BotChain = typeof botChain | typeof botChainTestnet

export interface NetworkInfo {
  chain: BotChain
  isMainnet: boolean
  rpcUrl: string
  /** Network name in hardhat.config.ts */
  hardhatNetwork: "botTestnet" | "botMainnet"
  explorerUrl: string
  /** Etherscan-compatible API used for contract verification (BOTScan is Blockscout). */
  verifierUrl: string
}

/** Load .env from the template root, if it exists. Values already in the environment win. */
export function loadEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env")
}

/** True when the user asked for mainnet with `--mainnet` or `MAINNET=true`. */
export function wantsMainnet(argv = process.argv): boolean {
  return argv.includes("--mainnet") || process.env.MAINNET === "true"
}

export function getNetwork(mainnet = wantsMainnet()): NetworkInfo {
  const chain = mainnet ? botChain : botChainTestnet
  const rpcOverride = mainnet ? process.env.BOT_MAINNET_RPC_URL : process.env.BOT_TESTNET_RPC_URL
  const explorerUrl = chain.blockExplorers.default.url
  return {
    chain,
    isMainnet: mainnet,
    rpcUrl: rpcOverride || chain.rpcUrls.default.http[0],
    hardhatNetwork: mainnet ? "botMainnet" : "botTestnet",
    explorerUrl,
    verifierUrl: `${explorerUrl}/api/`,
  }
}

export const txUrl = (net: NetworkInfo, hash: string) => `${net.explorerUrl}/tx/${hash}`
export const addressUrl = (net: NetworkInfo, address: string) => `${net.explorerUrl}/address/${address}`

/** Reads PRIVATE_KEY from the environment and makes sure it is a 0x-prefixed 32-byte hex string. */
export function getPrivateKey(): Hex {
  const raw = (process.env.PRIVATE_KEY || "").trim()
  if (!raw) {
    fail(
      "PRIVATE_KEY is not set.",
      "Copy .env.example to .env and paste the private key of a fresh testnet wallet after PRIVATE_KEY=",
    )
  }
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    fail(
      "PRIVATE_KEY does not look like a private key.",
      "It should be 64 hex characters (optionally starting with 0x). Do not paste a seed phrase or an address.",
    )
  }
  // Child processes (forge, hardhat) expect the 0x prefix.
  process.env.PRIVATE_KEY = key
  return key
}

export function getClients(net: NetworkInfo, key?: Hex) {
  const publicClient = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) })
  if (!key) return { publicClient, walletClient: undefined, account: undefined }
  const account = privateKeyToAccount(key)
  const walletClient = createWalletClient({ account, chain: net.chain, transport: http(net.rpcUrl) })
  return { publicClient, walletClient, account }
}

/**
 * Stops the script unless the RPC really is the chain we expect.
 * Catches a mainnet RPC URL pasted into BOT_TESTNET_RPC_URL.
 */
export async function assertChain(net: NetworkInfo): Promise<void> {
  const publicClient = createPublicClient({ transport: http(net.rpcUrl) })
  let actual: number
  try {
    actual = await publicClient.getChainId()
  } catch (error) {
    fail(
      `Could not reach the RPC at ${net.rpcUrl}.`,
      `Check your internet connection and any RPC override in .env. (${short(error)})`,
    )
  }
  if (actual === botChain.id && !net.isMainnet) {
    fail(
      `The RPC at ${net.rpcUrl} is BOT Chain mainnet (${botChain.id}), but you did not ask for mainnet.`,
      "Remove the mainnet URL from BOT_TESTNET_RPC_URL, or pass --mainnet if you really mean it.",
    )
  }
  if (actual !== net.chain.id) {
    fail(
      `Expected chain ${net.chain.id} (${net.chain.name}) but the RPC reports chain ${actual}.`,
      "Check the RPC URL in .env.",
    )
  }
}

/** On mainnet, print a warning and require the user to type MAINNET. Does nothing on testnet. */
export async function confirmMainnet(net: NetworkInfo, action: string): Promise<void> {
  if (!net.isMainnet) return
  console.log("")
  console.log(`WARNING: you are about to use ${net.chain.name} (chain ${net.chain.id}) with real funds.`)
  console.log(`Action: ${action}`)
  console.log("This template has not been audited. Transactions cannot be undone.")
  if (!process.stdin.isTTY) fail("Mainnet actions need a typed confirmation, so they cannot run non-interactively.")
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question("Type MAINNET to continue, or anything else to cancel: ")
  rl.close()
  if (answer.trim() !== "MAINNET") fail("Cancelled. Nothing was sent.")
}

/** Stops with a faucet hint when the account has no gas money. */
export async function assertHasGas(net: NetworkInfo, address: Hex): Promise<bigint> {
  const { publicClient } = getClients(net)
  const balance = await publicClient.getBalance({ address })
  if (balance === 0n) {
    fail(
      `${address} has 0 ${net.chain.nativeCurrency.symbol}, so it cannot pay for gas.`,
      net.isMainnet
        ? "Send some BOT to this address first."
        : "Get free tBOT at https://faucet.botchain.ai/basic (10 tBOT per address every 24 hours), then try again.",
    )
  }
  return balance
}

export function short(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error) return String(error.shortMessage)
  return error instanceof Error ? error.message : String(error)
}

/** Thrown by fail(). Caught below so the user sees the message and hint, not a stack trace. */
class ScriptError extends Error {}

// Calling process.exit() while viem's HTTP sockets are open crashes Node on Windows
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"). Throwing and setting
// exitCode lets Node close the sockets and exit on its own.
process.on("uncaughtException", (error) => {
  if (!(error instanceof ScriptError)) console.error(error)
  process.exitCode = 1
})

export function fail(message: string, hint?: string): never {
  console.error(`\nError: ${message}`)
  if (hint) console.error(`Fix: ${hint}`)
  throw new ScriptError(message)
}
