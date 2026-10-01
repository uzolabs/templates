// Adds liquidity to a BDEX V2 pair through Router02, and creates the pair if it does not exist yet.
//
//   npm run add-liquidity-v2 -- 0.1 WBOT USDT          the USDT amount is worked out from the pair's current price
//   npm run add-liquidity-v2 -- 0.1 BOT USDT           pays BOT as the value (addLiquidityETH)
//   npm run add-liquidity-v2 -- 0.1 WBOT 1.6 USDT      both amounts given; needed when the pair is new
//
// You get LP tokens (the pair contract is itself an ERC-20) that you can later redeem with removeLiquidity.
import { bdexV2Router02Abi } from "@uzolabs/sdk/contracts"
import { erc20Abi, formatUnits, parseAbi, type Address } from "viem"
import { deadlineFrom, minAmountOut } from "../frontend/src/dex/math.js"
import { findV2Pair, tradeKind } from "../frontend/src/dex/routes.js"
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
import { addressUrl, confirmMainnet, fail, loadEnv } from "./lib/network.js"
import { approveIfNeeded, getSigner, sendAndWait } from "./lib/tx.js"

const USAGE = "Usage: npm run add-liquidity-v2 -- <amount> <tokenA> [<amountB>] <tokenB>"
// The SDK does not ship the pair ABI, so these are the two functions this script reads.
const pairAbi = parseAbi([
  "function token0() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
])

loadEnv()
const { positionals, flags } = parseArgs()
const signer = await getSigner()
const { publicClient, walletClient, account, net } = signer
const { book, tokens } = getDex(net)
const explicitB = positionals.length === 4
const a = tokenArg(tokens, positionals[1], USAGE)
const b = tokenArg(tokens, positionals[explicitB ? 3 : 2], USAGE)
const amountA = amountArg(positionals[0], a, USAGE)
const slippage = slippageArg(flags.get("slippage"))
if (tradeKind(a.symbol, b.symbol) !== "swap")
  fail("Pick WBOT or BOT with USDT. BOT and WBOT do not need a pool.", USAGE)
if (a.isNative && b.isNative) fail("Only one side can be BOT.")

const pair = await findV2Pair(publicClient, book, a.address, b.address)
let amountB: bigint
if (explicitB) {
  amountB = amountArg(positionals[2], b, USAGE)
} else {
  if (!pair) fail(`There is no ${a.symbol}/${b.symbol} pair yet, so give both amounts.`, USAGE)
  const [token0, [reserve0, reserve1]] = await Promise.all([
    publicClient.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
    publicClient.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }),
  ])
  const [reserveA, reserveB] =
    token0.toLowerCase() === a.address.toLowerCase() ? [reserve0, reserve1] : [reserve1, reserve0]
  if (reserveA === 0n || reserveB === 0n) fail("The pair is empty, so give both amounts.", USAGE)
  // Router02.quote: the amount of B worth amountA at the pair's current price.
  amountB = await publicClient.readContract({
    address: book.bdexV2Router02,
    abi: bdexV2Router02Abi,
    functionName: "quote",
    args: [amountA, reserveA, reserveB],
  })
}

const lpBalance = (p: Address) =>
  publicClient.readContract({ address: p, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })
const before = await readBalances(publicClient, tokens, account.address)
const lpBefore = pair ? await lpBalance(pair) : 0n
printBalances("Before", tokens, before)
console.log(`  LP    ${formatUnits(lpBefore, 18)}`)
for (const [token, amount] of [
  [a, amountA],
  [b, amountB],
] as const) {
  if (before[token.symbol] < amount)
    fail(`You have ${formatToken(before[token.symbol], token)}, less than ${formatToken(amount, token)}.`)
}

console.log(
  `\nAdding ${formatToken(amountA, a)} and ${formatToken(amountB, b)}${pair ? "" : " (this creates the pair)"}.`,
)
console.log(`If the price moves more than ${slippage / 100}% first, the transaction reverts.\n`)
await confirmMainnet(net, `add ${formatToken(amountA, a)} and ${formatToken(amountB, b)} to BDEX V2`)

const deadline = deadlineFrom(Date.now())
const router = { account, address: book.bdexV2Router02, abi: bdexV2Router02Abi } as const
const native = a.isNative
  ? { bot: amountA, token: b, amount: amountB }
  : b.isNative
    ? { bot: amountB, token: a, amount: amountA }
    : undefined

if (native) {
  await approveIfNeeded(signer, native.token, book.bdexV2Router02, native.amount)
  await sendAndWait(signer, "Add liquidity", async () => {
    const { request } = await publicClient.simulateContract({
      ...router,
      functionName: "addLiquidityETH",
      args: [
        native.token.address,
        native.amount,
        minAmountOut(native.amount, slippage),
        minAmountOut(native.bot, slippage),
        account.address,
        deadline,
      ],
      value: native.bot,
    })
    return walletClient.writeContract(request)
  })
} else {
  await approveIfNeeded(signer, a, book.bdexV2Router02, amountA)
  await approveIfNeeded(signer, b, book.bdexV2Router02, amountB)
  await sendAndWait(signer, "Add liquidity", async () => {
    const { request } = await publicClient.simulateContract({
      ...router,
      functionName: "addLiquidity",
      args: [
        a.address,
        b.address,
        amountA,
        amountB,
        minAmountOut(amountA, slippage),
        minAmountOut(amountB, slippage),
        account.address,
        deadline,
      ],
    })
    return walletClient.writeContract(request)
  })
}

const pairNow = pair ?? (await findV2Pair(publicClient, book, a.address, b.address))!
printBalances("\nAfter", tokens, await readBalances(publicClient, tokens, account.address), before)
console.log(`  LP    ${formatUnits(await lpBalance(pairNow), 18)}`)
console.log(`\nPair: ${addressUrl(net, pairNow)}`)
