// The relayer: pays the gas for guest book messages signed by wallets that hold no BOT.
//
//   npm run relayer                 testnet, reads .env and deployments/<chainId>.json
//   npm run relayer -- --mainnet    mainnet (fund the relayer wallet with real BOT first)
//
//   POST /relay    { "request": { from, to, value, gas, deadline, data, signature } }
//   GET  /health   relayer address and balance
import { serve } from "@hono/node-server"
import { getConnInfo } from "@hono/node-server/conninfo"
import type { Context } from "hono"
import { formatEther, getAddress, isAddress, parseEther, type Address, type Hex } from "viem"
import { readDeployments } from "../../scripts/lib/deployments.js"
import { assertChain, fail, getNetwork, loadEnv, txUrl } from "../../scripts/lib/network.js"
import { createApp } from "./app.js"
import { createChain } from "./chain.js"
import { paymasterFromEnv } from "./paymaster.js"

loadEnv()
const net = getNetwork()

const rawKey = (process.env.RELAYER_PRIVATE_KEY || "").trim()
if (!rawKey)
  fail(
    "RELAYER_PRIVATE_KEY is not set.",
    "Create a separate test wallet for the relayer, paste its key after RELAYER_PRIVATE_KEY= in .env, and send it some tBOT.",
  )
const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail("RELAYER_PRIVATE_KEY does not look like a private key (64 hex characters).")

/** Address from env, else from the deploy record, else stop with a hint. */
function contractAddress(envName: string, contract: string): Address {
  const fromEnv = process.env[envName]?.trim()
  if (fromEnv) {
    if (!isAddress(fromEnv)) fail(`${envName} is not an address.`)
    return getAddress(fromEnv)
  }
  const record = readDeployments(net.chain.id)[contract]
  if (!record)
    fail(`No ${contract} deployment for chain ${net.chain.id}.`, "Run npm run deploy first, or set " + envName)
  return record.address
}

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback)
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} must be a whole number above zero.`)
  return value
}

const guestBook = contractAddress("GUESTBOOK_ADDRESS", "GuestBook")
const forwarder = contractAddress("FORWARDER_ADDRESS", "UzoForwarder")
const port = positiveInt("RELAYER_PORT", 8787)
const paymaster = paymasterFromEnv()
const trustProxy = process.env.RELAYER_TRUST_PROXY === "true"

await assertChain(net)
const chain = createChain({ net, key, forwarder, paymaster })

const getIp = (c: Context): string => {
  // Only trust X-Forwarded-For behind your own proxy; otherwise anyone can fake it to dodge the limit.
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    if (forwarded) return forwarded
  }
  return getConnInfo(c).remote.address ?? "unknown"
}

const { app, checkBalance } = createApp({
  chain,
  guestBook,
  maxGas: BigInt(positiveInt("RELAYER_MAX_GAS", 300_000)),
  rateLimit: positiveInt("RELAYER_RATE_LIMIT", 10),
  rateWindowMs: positiveInt("RELAYER_RATE_WINDOW_SECONDS", 3600) * 1000,
  lowBalance: parseEther(process.env.RELAYER_LOW_BALANCE || "1"),
  allowedOrigins: (process.env.RELAYER_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  txUrl: (hash) => txUrl(net, hash),
  getIp,
})

const balance = await checkBalance()
serve({ fetch: app.fetch, port }, () => {
  console.log(`Relayer for ${net.chain.name} (chain ${net.chain.id}) listening on http://localhost:${port}`)
  console.log(`  Relayer:   ${chain.relayer} (${formatEther(balance)} ${net.chain.nativeCurrency.symbol})`)
  console.log(`  Forwarder: ${forwarder}`)
  console.log(`  GuestBook: ${guestBook}`)
  console.log(`  Paymaster: ${paymaster ? paymaster.url : "off (PAYMASTER_URL is blank)"}`)
})
