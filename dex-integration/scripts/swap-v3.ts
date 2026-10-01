// Swaps in one BDEX V3 pool through SwapRouter.exactInputSingle.
//
//   npm run swap-v3 -- 0.1 WBOT USDT                  uses the V3 pool with the best quote
//   npm run swap-v3 -- 0.1 WBOT USDT --fee 3000       uses the 0.3% pool
//   npm run swap-v3 -- 0.1 BOT USDT                   pays BOT as the transaction value, no approval
//   npm run swap-v3 -- 2 USDT BOT --slippage 1        swaps to WBOT, then unwraps it to BOT in the same transaction
//
// Steps: quote with QuoterV2, work out the least you accept (slippage, default 0.5%),
// approve SwapRouter to take the input token if needed, then swap with a 20 minute deadline.
import { bdexV3SwapRouterAbi } from "@uzolabs/sdk/contracts"
import { encodeFunctionData, zeroAddress } from "viem"
import { deadlineFrom, feeLabel, minAmountOut, pickBest, V3_FEES, type V3Fee } from "../frontend/src/dex/math.js"
import { findV3Pools, quoteV3, tradeKind } from "../frontend/src/dex/routes.js"
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

const USAGE = "Usage: npm run swap-v3 -- <amount> <from> <to> [--fee 500|3000|10000]"

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

let fees: readonly V3Fee[] = (await findV3Pools(publicClient, book, from.address, to.address)).map((p) => p.fee)
if (flags.has("fee")) {
  const wanted = Number(flags.get("fee"))
  if (!V3_FEES.includes(wanted as V3Fee)) fail(`--fee must be one of ${V3_FEES.join(", ")}.`, USAGE)
  if (!fees.includes(wanted as V3Fee)) fail(`There is no ${feeLabel(wanted)} V3 pool for ${from.symbol}/${to.symbol}.`)
  fees = [wanted as V3Fee]
}
if (fees.length === 0) fail(`There is no V3 pool for ${from.symbol}/${to.symbol}. Try npm run swap-v2 instead.`)

const before = await readBalances(publicClient, tokens, account.address)
printBalances("Before", tokens, before)
if (before[from.symbol] < amountIn)
  fail(`You have ${formatToken(before[from.symbol], from)}, less than ${formatToken(amountIn, from)}.`)

const quotes = await Promise.all(
  fees.map((fee) => quoteV3(publicClient, book, amountIn, from.address, to.address, fee)),
)
const quote = pickBest(quotes.filter((q) => q !== undefined))
if (!quote) fail(`No V3 pool can fill this trade. Try npm run quote -- ${positionals[0]} ${from.symbol} ${to.symbol}`)
const minOut = minAmountOut(quote.amountOut, slippage)
console.log(`\nPool:    ${feeLabel(quote.fee)} fee tier`)
console.log(`Quote:   ${formatToken(amountIn, from)} gives about ${formatToken(quote.amountOut, to)}`)
console.log(`Minimum: ${formatToken(minOut, to)} (${slippage / 100}% slippage). Less than that and the swap reverts.\n`)

await confirmMainnet(net, `swap ${formatToken(amountIn, from)} for at least ${formatToken(minOut, to)} on BDEX V3`)
await approveIfNeeded(signer, from, book.bdexV3SwapRouter, amountIn)

const params = {
  tokenIn: from.address,
  tokenOut: to.address,
  fee: quote.fee,
  recipient: account.address,
  deadline: deadlineFrom(Date.now()),
  amountIn,
  amountOutMinimum: minOut,
  // 0 means "no price limit": the slippage check above is what protects you.
  sqrtPriceLimitX96: 0n,
}
const router = { account, address: book.bdexV3SwapRouter, abi: bdexV3SwapRouterAbi } as const

await sendAndWait(signer, "Swap", async () => {
  if (to.isNative) {
    // Two steps in one transaction with multicall: swap into WBOT held by the router
    // (recipient 0 means "the router itself"), then unwrapWETH9 sends you the BOT.
    const swap = encodeFunctionData({
      abi: bdexV3SwapRouterAbi,
      functionName: "exactInputSingle",
      args: [{ ...params, recipient: zeroAddress }],
    })
    const unwrap = encodeFunctionData({
      abi: bdexV3SwapRouterAbi,
      functionName: "unwrapWETH9",
      args: [minOut, account.address],
    })
    const { request } = await publicClient.simulateContract({
      ...router,
      functionName: "multicall",
      args: [[swap, unwrap]],
    })
    return walletClient.writeContract(request)
  }
  // Native BOT in: send it as the value and the router wraps it into WBOT before paying the pool.
  const { request } = await publicClient.simulateContract({
    ...router,
    functionName: "exactInputSingle",
    args: [params],
    value: from.isNative ? amountIn : 0n,
  })
  return walletClient.writeContract(request)
})

printBalances("\nAfter", tokens, await readBalances(publicClient, tokens, account.address), before)
