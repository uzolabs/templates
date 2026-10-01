// Builds the transactions the web app sends: approve, wrap, unwrap and swap.
// The scripts spell out the same calls one by one (scripts/swap-v2.ts and scripts/swap-v3.ts).
import { bdexV2Router02Abi, bdexV3SwapRouterAbi, wbotAbi } from "@uzolabs/sdk/contracts"
import { encodeFunctionData, erc20Abi, zeroAddress, type Address, type Hex } from "viem"
import { deadlineFrom, minAmountOut } from "./math.js"
import type { AddressBook, Quote, Token } from "./routes.js"

export type TxRequest = { to: Address; data: Hex; value: bigint }

/** The router that has to be approved to spend the input token for this quote. */
export const spenderFor = (book: AddressBook, quote: Quote) =>
  quote.version === "V2" ? book.bdexV2Router02 : book.bdexV3SwapRouter

export function buildApprove(token: Token, spender: Address, amount: bigint): TxRequest {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] })
  return { to: token.address, data, value: 0n }
}

/** BOT to WBOT is deposit() with the BOT as value; WBOT to BOT is withdraw(amount). */
export function buildWrap(book: AddressBook, unwrap: boolean, amount: bigint): TxRequest {
  return unwrap
    ? { to: book.wbot, data: encodeFunctionData({ abi: wbotAbi, functionName: "withdraw", args: [amount] }), value: 0n }
    : { to: book.wbot, data: encodeFunctionData({ abi: wbotAbi, functionName: "deposit" }), value: amount }
}

type SwapInput = {
  book: AddressBook
  from: Token
  to: Token
  amountIn: bigint
  quote: Quote
  slippageBps: number
  recipient: Address
  nowMs: number
}

export function buildSwap({ book, from, to, amountIn, quote, slippageBps, recipient, nowMs }: SwapInput): TxRequest {
  const minOut = minAmountOut(quote.amountOut, slippageBps)
  const deadline = deadlineFrom(nowMs)
  // Native BOT goes in as the transaction value. The routers wrap it into WBOT themselves.
  const value = from.isNative ? amountIn : 0n

  if (quote.version === "V2") {
    const path = [from.address, to.address] as const
    const data = from.isNative
      ? encodeFunctionData({
          abi: bdexV2Router02Abi,
          functionName: "swapExactETHForTokens",
          args: [minOut, path, recipient, deadline],
        })
      : to.isNative
        ? encodeFunctionData({
            abi: bdexV2Router02Abi,
            functionName: "swapExactTokensForETH",
            args: [amountIn, minOut, path, recipient, deadline],
          })
        : encodeFunctionData({
            abi: bdexV2Router02Abi,
            functionName: "swapExactTokensForTokens",
            args: [amountIn, minOut, path, recipient, deadline],
          })
    return { to: book.bdexV2Router02, data, value }
  }

  const params = {
    tokenIn: from.address,
    tokenOut: to.address,
    fee: quote.fee,
    recipient,
    deadline,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  }
  if (!to.isNative) {
    const data = encodeFunctionData({ abi: bdexV3SwapRouterAbi, functionName: "exactInputSingle", args: [params] })
    return { to: book.bdexV3SwapRouter, data, value }
  }
  // Native BOT out: swap into WBOT kept by the router (recipient 0 means the router itself),
  // then unwrapWETH9 sends you BOT. multicall runs both in one transaction.
  const calls = [
    encodeFunctionData({
      abi: bdexV3SwapRouterAbi,
      functionName: "exactInputSingle",
      args: [{ ...params, recipient: zeroAddress }],
    }),
    encodeFunctionData({ abi: bdexV3SwapRouterAbi, functionName: "unwrapWETH9", args: [minOut, recipient] }),
  ]
  const data = encodeFunctionData({ abi: bdexV3SwapRouterAbi, functionName: "multicall", args: [calls] })
  return { to: book.bdexV3SwapRouter, data, value }
}
