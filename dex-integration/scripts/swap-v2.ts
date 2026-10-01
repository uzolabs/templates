// Swaps on the BDEX V2 pair through Router02.
//
//   npm run swap-v2 -- 0.1 WBOT USDT                  swapExactTokensForTokens
//   npm run swap-v2 -- 0.1 BOT USDT                   swapExactETHForTokens (pays BOT, no approval)
//   npm run swap-v2 -- 2 USDT BOT --slippage 1        swapExactTokensForETH (you get BOT back)
//   npm run swap-v2 -- 0.1 WBOT USDT --mainnet
//
// Steps: quote with getAmountsOut, work out the least you accept (slippage, default 0.5%),
// approve Router02 to take the input token if needed, then swap with a 20 minute deadline.
import { bdexV2Router02Abi } from "@uzolabs/sdk/contracts"
import { deadlineFrom, minAmountOut } from "../frontend/src/dex/math.js"
import { quoteV2, tradeKind } from "../frontend/src/dex/routes.js"
import {
  amountArg,
  formatToken,
  getDex,
  parseArgs,
  printBalances,
  readBalances,
  slippageArg,
  tokenArg,
} from "./lib/cli.js"
import { confirmMainnet, fail, loadEnv } from "./lib/network.js"
import { approveIfNeeded, getSigner, sendAndWait } from "./lib/tx.js"

const USAGE = "Usage: npm run swap-v2 -- <amount> <from> <to>, for example npm run swap-v2 -- 0.1 WBOT USDT"

loadEnv()
const { positionals, flags } = parseArgs()
const signer = await getSigner()
const { publicClient, walletClient, account, net } = signer
const { book, tokens } = getDex(net)
const from = tokenArg(tokens, positionals[1], USAGE)
const to = tokenArg(tokens, positionals[2], USAGE)
const amountIn = amountArg(positionals[0], from, USAGE)
const slippage = slippageArg(flags.get("slippage"))

const kind = tradeKind(from.symbol, to.symbol)
if (kind === "same") fail("Pick two different tokens.", USAGE)
if (kind !== "swap") fail(`${from.symbol} and ${to.symbol} are 1:1 and need no pool. Use npm run wrap instead.`)

const before = await readBalances(publicClient, tokens, account.address)
printBalances("Before", tokens, before)
if (before[from.symbol] < amountIn)
  fail(`You have ${formatToken(before[from.symbol], from)}, less than ${formatToken(amountIn, from)}.`)

const quote = await quoteV2(publicClient, book, amountIn, from.address, to.address)
if (!quote)
  fail(`The V2 pair cannot fill this trade. Try npm run quote -- ${positionals[0]} ${from.symbol} ${to.symbol}`)
const minOut = minAmountOut(quote.amountOut, slippage)
console.log(`\nQuote:   ${formatToken(amountIn, from)} gives about ${formatToken(quote.amountOut, to)}`)
console.log(`Minimum: ${formatToken(minOut, to)} (${slippage / 100}% slippage). Less than that and the swap reverts.\n`)

await confirmMainnet(net, `swap ${formatToken(amountIn, from)} for at least ${formatToken(minOut, to)} on BDEX V2`)
await approveIfNeeded(signer, from, book.bdexV2Router02, amountIn)

const path = [from.address, to.address] as const
const recipient = account.address
const deadline = deadlineFrom(Date.now())
const router = { account, address: book.bdexV2Router02, abi: bdexV2Router02Abi } as const

await sendAndWait(signer, "Swap", async () => {
  if (from.isNative) {
    // Native BOT in: the router wraps the transaction value into WBOT for you.
    const { request } = await publicClient.simulateContract({
      ...router,
      functionName: "swapExactETHForTokens",
      args: [minOut, path, recipient, deadline],
      value: amountIn,
    })
    return walletClient.writeContract(request)
  }
  if (to.isNative) {
    // Native BOT out: the router unwraps the WBOT it receives and sends you BOT.
    const { request } = await publicClient.simulateContract({
      ...router,
      functionName: "swapExactTokensForETH",
      args: [amountIn, minOut, path, recipient, deadline],
    })
    return walletClient.writeContract(request)
  }
  const { request } = await publicClient.simulateContract({
    ...router,
    functionName: "swapExactTokensForTokens",
    args: [amountIn, minOut, path, recipient, deadline],
  })
  return walletClient.writeContract(request)
})

printBalances("\nAfter", tokens, await readBalances(publicClient, tokens, account.address), before)
