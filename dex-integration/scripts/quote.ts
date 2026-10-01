// Prices a swap on every BDEX route (the V2 pair and each V3 pool) and marks the best one.
// Read only: it needs no private key and sends nothing.
//
//   npm run quote                        1 WBOT to USDT
//   npm run quote -- 0.5 BOT USDT
//   npm run quote -- 10 USDT WBOT --slippage 1
import { DEFAULT_SLIPPAGE_BPS, minAmountOut, pickBest } from "../frontend/src/dex/math.js"
import { quoteAll, routeLabel, tradeKind } from "../frontend/src/dex/routes.js"
import { amountArg, formatToken, getDex, parseArgs, slippageArg, tokenArg } from "./lib/cli.js"
import { assertChain, fail, getClients, getNetwork, loadEnv } from "./lib/network.js"

const USAGE = "Usage: npm run quote -- <amount> <from> <to>, for example npm run quote -- 1 WBOT USDT"

loadEnv()
const { positionals, flags } = parseArgs()
const net = getNetwork()
const { publicClient } = getClients(net)
await assertChain(net)
const { book, tokens } = getDex(net)

const from = tokenArg(tokens, positionals[1] ?? "WBOT", USAGE)
const to = tokenArg(tokens, positionals[2] ?? "USDT", USAGE)
const amountIn = amountArg(positionals[0] ?? "1", from, USAGE)
const slippage = flags.has("slippage") ? slippageArg(flags.get("slippage")) : DEFAULT_SLIPPAGE_BPS

const kind = tradeKind(from.symbol, to.symbol)
if (kind === "same") fail("Pick two different tokens.", USAGE)
if (kind === "wrap" || kind === "unwrap") {
  console.log(`${from.symbol} to ${to.symbol} is always 1:1 and needs no pool. Use npm run wrap.`)
} else {
  console.log(`Quotes for ${formatToken(amountIn, from)} to ${to.symbol} on ${net.chain.name}:\n`)
  const quotes = await quoteAll(publicClient, book, amountIn, from.address, to.address)
  if (quotes.length === 0)
    fail(`No BDEX pool can fill this trade. Run npm run find-pools -- ${from.symbol} ${to.symbol}`)

  const best = pickBest(quotes)!
  for (const q of quotes) {
    const mark = q === best ? "  <- best" : ""
    console.log(`  ${routeLabel(q).padEnd(24)} ${formatToken(q.amountOut, to)}${mark}`)
  }
  console.log(
    `\nWith ${slippage / 100}% slippage you would accept at least ${formatToken(minAmountOut(best.amountOut, slippage), to)}.`,
  )
  const trade = `${positionals[0] ?? "1"} ${from.symbol} ${to.symbol}`
  const command =
    best.version === "V2" ? `npm run swap-v2 -- ${trade}` : `npm run swap-v3 -- ${trade} --fee ${best.fee}`
  console.log(`To swap on the best route: ${command}`)
}
