// Lists the BDEX pools for two tokens: the V2 pair and a V3 pool for each fee tier, with what each one holds.
// Read only: it needs no private key and sends nothing.
//
//   npm run find-pools                   WBOT and USDT
//   npm run find-pools -- WBOT USDT
//   npm run find-pools -- --mainnet
//
// BOT trades through WBOT, so "BOT" is looked up as WBOT.
import { erc20Abi, formatUnits, type Address } from "viem"
import { feeLabel, V3_FEES } from "../frontend/src/dex/math.js"
import { findV2Pair, findV3Pools, type Token } from "../frontend/src/dex/routes.js"
import { getDex, parseArgs, tokenArg } from "./lib/cli.js"
import { addressUrl, assertChain, fail, getClients, getNetwork, loadEnv } from "./lib/network.js"

const USAGE = "Usage: npm run find-pools -- WBOT USDT"

loadEnv()
const { positionals } = parseArgs()
const net = getNetwork()
const { publicClient } = getClients(net)
await assertChain(net)
const { book, tokens } = getDex(net)

const a = tokenArg(tokens, positionals[0] ?? "WBOT", USAGE)
const b = tokenArg(tokens, positionals[1] ?? "USDT", USAGE)
if (a.address === b.address) fail(`${a.symbol} and ${b.symbol} are the same token in a pool. Pick two different ones.`)

console.log(`Pools for ${a.symbol}/${b.symbol} on ${net.chain.name}\n`)

/** What a pool holds of each token. A pool with nothing in it cannot fill a swap. */
async function holdings(pool: Address) {
  const [ofA, ofB] = await Promise.all(
    [a, b].map((t: Token) =>
      publicClient.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
    ),
  )
  return `holds ${formatUnits(ofA!, a.decimals)} ${a.symbol} and ${formatUnits(ofB!, b.decimals)} ${b.symbol}`
}

const pair = await findV2Pair(publicClient, book, a.address, b.address)
console.log("BDEX V2")
if (pair) {
  console.log(`  pair ${pair}`)
  console.log(`       ${await holdings(pair)}`)
  console.log(`       ${addressUrl(net, pair)}`)
} else {
  console.log("  no pair")
}

const pools = await findV3Pools(publicClient, book, a.address, b.address)
console.log("\nBDEX V3")
for (const fee of V3_FEES) {
  const found = pools.find((p) => p.fee === fee)
  if (!found) {
    console.log(`  ${feeLabel(fee).padEnd(6)} no pool`)
    continue
  }
  console.log(`  ${feeLabel(fee).padEnd(6)} ${found.pool}`)
  console.log(`         ${await holdings(found.pool)}`)
  console.log(`         ${addressUrl(net, found.pool)}`)
}

if (!pair && pools.length === 0) console.log(`\nNo pools yet. npm run add-liquidity-v2 can create the V2 pair.`)
